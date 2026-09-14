import { server, db, currentUser, captureError } from '@aha-app/builder-core';
import { eq, desc, and, sql } from 'drizzle-orm';
import {
  migrationProjectsTable,
  migrationRecordsTable,
  destinationFieldsTable,
  recordDiscussionsTable,
  auditLogTable,
  type MigrationProject,
  type NewMigrationProject,
} from '@/db/schema';

export async function getProjects(): Promise<MigrationProject[]> {
  return db.select().from(migrationProjectsTable).orderBy(desc(migrationProjectsTable.createdAt));
}

export async function getProject(input: { id: number }): Promise<MigrationProject | null> {
  const rows = await db.select().from(migrationProjectsTable).where(eq(migrationProjectsTable.id, input.id));
  return rows[0] ?? null;
}

export async function createProject(input: {
  name: string;
  sourceOrg: string;
  destinationOrg: string;
  description?: string;
  stakeholders?: string;
}): Promise<MigrationProject> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const [project] = await db.insert(migrationProjectsTable).values({
    name: input.name,
    sourceOrg: input.sourceOrg,
    destinationOrg: input.destinationOrg,
    description: input.description ?? null,
    stakeholders: input.stakeholders ?? null,
    createdById: user.id,
    setupStep: 1,
    setupComplete: false,
  }).returning();

  await db.insert(auditLogTable).values({
    projectId: project.id,
    action: 'project_created',
    details: `Project "${project.name}" created`,
    performedById: user.id,
  });

  return project;
}

export async function updateProjectSetup(input: {
  id: number;
  setupStep?: number;
  setupComplete?: boolean;
  referenceDataSkipped?: boolean;
  sourceColumnPolicies?: Record<string, string>;
}): Promise<MigrationProject> {
  const { id, ...fields } = input;
  const updateData: Partial<NewMigrationProject> = { updatedAt: new Date() };
  if (fields.setupStep !== undefined) updateData.setupStep = fields.setupStep;
  if (fields.setupComplete !== undefined) updateData.setupComplete = fields.setupComplete;
  if (fields.referenceDataSkipped !== undefined) updateData.referenceDataSkipped = fields.referenceDataSkipped;
  if (fields.sourceColumnPolicies !== undefined) updateData.sourceColumnPolicies = fields.sourceColumnPolicies;
  const [project] = await db.update(migrationProjectsTable).set(updateData).where(eq(migrationProjectsTable.id, id)).returning();
  return project;
}

export async function updateProject(input: {
  id: number;
  name?: string;
  sourceOrg?: string;
  destinationOrg?: string;
  description?: string;
  stakeholders?: string;
  status?: MigrationProject['status'];
}): Promise<MigrationProject> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const { id, ...fields } = input;
  const updateData: Partial<NewMigrationProject> = { updatedAt: new Date() };
  if (fields.name !== undefined) updateData.name = fields.name;
  if (fields.sourceOrg !== undefined) updateData.sourceOrg = fields.sourceOrg;
  if (fields.destinationOrg !== undefined) updateData.destinationOrg = fields.destinationOrg;
  if (fields.description !== undefined) updateData.description = fields.description;
  if (fields.stakeholders !== undefined) updateData.stakeholders = fields.stakeholders;
  if (fields.status !== undefined) updateData.status = fields.status;

  const [project] = await db.update(migrationProjectsTable)
    .set(updateData)
    .where(eq(migrationProjectsTable.id, id))
    .returning();

  return project;
}

export async function deleteProject(input: { id: number }): Promise<void> {
  await db.delete(migrationProjectsTable).where(eq(migrationProjectsTable.id, input.id));
}

export interface FinalizationChecklistItem {
  key: string;
  label: string;
  status: 'ok' | 'blocking' | 'warning';
  detail: string;
  link?: string;
}

export interface FinalizationChecklist {
  items: FinalizationChecklistItem[];
  canFinalize: boolean;
  /** Total source records imported into this project */
  tracked: number;
  /** @deprecated Use tracked */
  total: number;
  /** Records with a final disposition: approved + consolidated + excluded */
  finalized: number;
  /** Records with no final disposition: pending + discussing */
  unresolved: number;
  /** Records in 'pending' status */
  pending: number;
  /** Records in 'discussing' status */
  discussing: number;
  /** Records that are approved and ready for export */
  approved: number;
}

export async function getFinalizationChecklist(input: { projectId: number }): Promise<FinalizationChecklist> {
  const [recordCounts, fieldCounts, openDiscussions, blockingViolations] = await Promise.all([
    db.select({
      total: sql`count(*)::int`,
      approved: sql`count(*) filter (where status = 'approved')::int`,
      consolidated: sql`count(*) filter (where status = 'consolidated')::int`,
      excluded: sql`count(*) filter (where status = 'excluded')::int`,
      pending: sql`count(*) filter (where status = 'pending')::int`,
      discussing: sql`count(*) filter (where status = 'discussing')::int`,
    }).from(migrationRecordsTable).where(eq(migrationRecordsTable.projectId, input.projectId)),
    db.select({
      total: sql`count(*)::int`,
      mapped: sql`count(*) filter (where source_mapping is not null)::int`,
      confirmed: sql`count(*) filter (where is_confirmed = true)::int`,
    }).from(destinationFieldsTable).where(eq(destinationFieldsTable.projectId, input.projectId)),
    db.select({ count: sql`count(*)::int` }).from(recordDiscussionsTable)
      .where(and(
        eq(recordDiscussionsTable.projectId, input.projectId),
        sql`discussion_status = 'open'`,
      )),
    // Blocking violations: records with unresolved rule violations that will be migrated.
    // Excluded and consolidated records are exempt — excluded won't be migrated,
    // consolidated are already resolved.
    db.select({ count: sql`count(*)::int` }).from(migrationRecordsTable)
      .where(and(
        eq(migrationRecordsTable.projectId, input.projectId),
        sql`destination_rule_findings is not null and jsonb_array_length(destination_rule_findings) > 0`,
        sql`status not in ('excluded', 'consolidated')`,
      )),
  ]);

  const rc = recordCounts[0];
  const fc = fieldCounts[0];
  const total = Number(rc?.total ?? 0);
  const approved = Number(rc?.approved ?? 0);
  const consolidated = Number(rc?.consolidated ?? 0);
  const excluded = Number(rc?.excluded ?? 0);
  const finalized = approved + consolidated + excluded;
  const discussing = Number(rc?.discussing ?? 0);
  const pending = Number(rc?.pending ?? 0);
  const unresolved = discussing + pending;
  const openDisc = Number(openDiscussions[0]?.count ?? 0);
  const blocking = Number(blockingViolations[0]?.count ?? 0);
  const totalFields = Number(fc?.total ?? 0);
  const mappedFields = Number(fc?.mapped ?? 0);
  const confirmedFields = Number(fc?.confirmed ?? 0);

  const items: FinalizationChecklistItem[] = [
    {
      key: 'records_tracked',
      label: 'All source records tracked',
      status: total > 0 ? 'ok' : 'blocking',
      detail: total > 0 ? `${total} source records imported` : 'No source records found',
    },
    {
      key: 'all_finalized',
      label: 'All source records have final dispositions',
      status: unresolved === 0 && total > 0 ? 'ok' : 'blocking',
      detail: unresolved === 0
        ? `All ${total} records finalized`
        : `${unresolved} record${unresolved !== 1 ? 's' : ''} still pending or in discussion`,
      link: unresolved > 0 ? 'review' : undefined,
    },
    {
      key: 'no_open_discussions',
      label: 'No unresolved discussions',
      status: openDisc === 0 ? 'ok' : 'blocking',
      detail: openDisc === 0 ? 'All discussions resolved' : `${openDisc} open discussion${openDisc !== 1 ? 's' : ''}`,
      link: openDisc > 0 ? 'review' : undefined,
    },
    {
      key: 'no_blocking_violations',
      label: 'No blocking destination-rule violations',
      status: blocking === 0 ? 'ok' : 'blocking',
      detail: blocking === 0
        ? 'No unresolved rule violations'
        : `${blocking} record${blocking !== 1 ? 's' : ''} with unresolved rule violations`,
      link: blocking > 0 ? 'review' : undefined,
    },
    {
      key: 'field_mappings',
      label: 'Field mappings complete',
      status: totalFields === 0 || mappedFields === totalFields ? 'ok' : 'warning',
      detail: totalFields === 0
        ? 'No destination fields defined'
        : mappedFields === totalFields
          ? `All ${totalFields} fields mapped`
          : `${mappedFields} of ${totalFields} fields mapped`,
      link: mappedFields < totalFields ? 'schema' : undefined,
    },
    {
      key: 'requirements_verified',
      label: 'Destination requirements verified',
      status: totalFields === 0 || confirmedFields === totalFields ? 'ok' : 'warning',
      detail: totalFields === 0
        ? 'No destination fields defined'
        : confirmedFields === totalFields
          ? `All ${totalFields} requirements verified`
          : `${confirmedFields} of ${totalFields} requirements verified`,
      link: confirmedFields < totalFields ? 'requirements' : undefined,
    },
  ];

  const canFinalize = items.filter(i => i.status === 'blocking').length === 0 && total > 0;

  return { items, canFinalize, tracked: total, total, finalized, unresolved, pending, discussing, approved };
}

export async function finalizeProject(input: { projectId: number }): Promise<MigrationProject> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const checklist = await getFinalizationChecklist({ projectId: input.projectId });
  if (!checklist.canFinalize) throw new Error('Cannot finalize: blocking checklist items remain');

  // Build snapshot of current state
  const [project, records, fields, auditLog, discussions] = await Promise.all([
    db.select().from(migrationProjectsTable).where(eq(migrationProjectsTable.id, input.projectId)).then(r => r[0]),
    db.select().from(migrationRecordsTable).where(eq(migrationRecordsTable.projectId, input.projectId)),
    db.select().from(destinationFieldsTable).where(eq(destinationFieldsTable.projectId, input.projectId)),
    db.select().from(auditLogTable).where(eq(auditLogTable.projectId, input.projectId)).then(r => r.slice(0, 500)),
    db.select().from(recordDiscussionsTable).where(eq(recordDiscussionsTable.projectId, input.projectId)),
  ]);

  const snapshot = {
    snapshotAt: new Date().toISOString(),
    project: { id: project?.id, name: project?.name, sourceOrg: project?.sourceOrg, destinationOrg: project?.destinationOrg },
    recordSummary: {
      total: checklist.total,
      finalized: checklist.finalized,
      approved: records.filter(r => r.status === 'approved').length,
      consolidated: records.filter(r => r.status === 'consolidated').length,
      excluded: records.filter(r => r.status === 'excluded').length,
    },
    fieldCount: fields.length,
    auditEventCount: auditLog.length,
    discussionCount: discussions.length,
  };

  const [updated] = await db.update(migrationProjectsTable)
    .set({
      status: 'finalized',
      finalizedAt: new Date(),
      finalizedById: user.id,
      finalizationSnapshot: snapshot,
      updatedAt: new Date(),
    })
    .where(eq(migrationProjectsTable.id, input.projectId))
    .returning();

  await db.insert(auditLogTable).values({
    projectId: input.projectId,
    action: 'migration_finalized',
    details: `Migration finalized by ${user.firstName ?? ''} ${user.lastName ?? ''} (${user.email}). Snapshot: ${checklist.finalized} records finalized, ${checklist.total} total.`,
    newState: 'finalized',
    actionContext: snapshot as unknown as Record<string, unknown>,
    performedById: user.id,
  });

  return updated;
}

export async function reopenProject(input: { projectId: number; reason: string }): Promise<MigrationProject> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');
  if (!input.reason?.trim()) throw new Error('Reason is required to reopen a finalized migration');

  const [existing] = await db.select().from(migrationProjectsTable).where(eq(migrationProjectsTable.id, input.projectId));
  if (!existing) throw new Error('Project not found');

  const [updated] = await db.update(migrationProjectsTable)
    .set({ status: 'reviewing', updatedAt: new Date() })
    .where(eq(migrationProjectsTable.id, input.projectId))
    .returning();

  await db.insert(auditLogTable).values({
    projectId: input.projectId,
    action: 'migration_reopened',
    details: `Migration reopened. Previous finalization preserved in audit history. Reason: ${input.reason}`,
    previousState: 'finalized',
    newState: 'reviewing',
    reason: input.reason,
    performedById: user.id,
  });

  return updated;
}

server.data('getProjects', getProjects);
server.data('getProject', getProject);
server.data('createProject', createProject);
server.data('updateProject', updateProject);
server.data('updateProjectSetup', updateProjectSetup);
server.data('deleteProject', deleteProject);
server.data('getFinalizationChecklist', getFinalizationChecklist);
server.data('finalizeProject', finalizeProject);
server.data('reopenProject', reopenProject);