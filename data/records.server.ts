// @ts-expect-error sendEmail is available at runtime but may not be in type defs
import { server, db, currentUser, captureError, sendEmail as sendEmailImpl } from '@aha-app/builder-core';
const sendEmail: (opts: { to: string; subject: string; contentType: string; body: string }) => void = sendEmailImpl as unknown as (opts: { to: string; subject: string; contentType: string; body: string }) => void;
import { eq, and, desc, sql, inArray, isNotNull, or } from 'drizzle-orm';
import {
  migrationRecordsTable,
  recordDiscussionsTable,
  discussionResponsesTable,
  auditLogTable,
  migrationProjectsTable,
  migrationStakeholdersTable,
  notificationsTable,
  usersTable,
  type MigrationRecord,
  type RecordDiscussion,
  type DiscussionResponse,
} from '@/db/schema';
import { renderDiscussionNotification } from '@/emails/discussionNotification';

export interface DiscussionWithResponses extends RecordDiscussion {
  responses: DiscussionResponse[];
}

export interface RecordWithDiscussions extends MigrationRecord {
  discussions: DiscussionWithResponses[];
}

export type QueueFilter =
  | 'all'
  | 'ready_for_approval'
  | 'rule_violations'
  | 'duplicates'
  | 'needs_discussion'
  | 'recommended_exclusions'
  | 'ai_findings'
  | 'pending'
  | 'approved'
  | 'excluded'
  | 'discussing'
  | 'consolidated';

export interface QueueCounts {
  all: number;
  ready_for_approval: number;
  rule_violations: number;
  duplicates: number;
  needs_discussion: number;
  recommended_exclusions: number;
  ai_findings: number;
  pending: number;
  approved: number;
  discussing: number;
  consolidated: number;
  excluded: number;
}

export async function getRecords(input: {
  projectId: number;
  status?: string;
  queue?: QueueFilter;
  limit?: number;
  offset?: number;
}): Promise<{ records: MigrationRecord[]; total: number }> {
  const conditions = [eq(migrationRecordsTable.projectId, input.projectId)];

  if (input.status && input.status !== 'all') {
    conditions.push(eq(migrationRecordsTable.status, input.status as MigrationRecord['status']));
  }

  const queue = input.queue;
  if (queue && queue !== 'all') {
    switch (queue) {
      case 'ready_for_approval':
        conditions.push(eq(migrationRecordsTable.recommendedDisposition, 'ready_for_approval'));
        conditions.push(eq(migrationRecordsTable.status, 'pending'));
        break;
      case 'rule_violations':
        conditions.push(isNotNull(migrationRecordsTable.destinationRuleFindings));
        break;
      case 'duplicates':
        conditions.push(eq(migrationRecordsTable.recommendedDisposition, 'consolidate'));
        break;
      case 'needs_discussion':
        conditions.push(eq(migrationRecordsTable.recommendedDisposition, 'discuss'));
        break;
      case 'recommended_exclusions':
        conditions.push(eq(migrationRecordsTable.recommendedDisposition, 'exclude'));
        break;
      case 'ai_findings':
        conditions.push(eq(migrationRecordsTable.recommendedDisposition, 'needs_manual_review'));
        break;
      case 'pending':
      case 'approved':
      case 'excluded':
      case 'discussing':
      case 'consolidated':
        conditions.push(eq(migrationRecordsTable.status, queue as MigrationRecord['status']));
        break;
    }
  }

  const whereClause = and(...conditions);
  const limit = input.limit ?? 50;
  const offset = input.offset ?? 0;

  const [records, countResult] = await Promise.all([
    db.select().from(migrationRecordsTable)
      .where(whereClause)
      .orderBy(desc(migrationRecordsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql`count(*)::int` })
      .from(migrationRecordsTable)
      .where(whereClause),
  ]);

  return { records, total: Number(countResult[0]?.count ?? 0) };
}

export async function getQueueCounts(input: { projectId: number }): Promise<QueueCounts> {
  const result = await db.select({
    all: sql`count(*)::int`,
    ready_for_approval: sql`count(*) filter (where recommended_disposition = 'ready_for_approval' and status = 'pending')::int`,
    rule_violations: sql`count(*) filter (where destination_rule_findings is not null)::int`,
    duplicates: sql`count(*) filter (where recommended_disposition = 'consolidate')::int`,
    needs_discussion: sql`count(*) filter (where recommended_disposition = 'discuss')::int`,
    recommended_exclusions: sql`count(*) filter (where recommended_disposition = 'exclude')::int`,
    ai_findings: sql`count(*) filter (where recommended_disposition = 'needs_manual_review')::int`,
    pending: sql`count(*) filter (where status = 'pending')::int`,
    approved: sql`count(*) filter (where status = 'approved')::int`,
    discussing: sql`count(*) filter (where status = 'discussing')::int`,
    consolidated: sql`count(*) filter (where status = 'consolidated')::int`,
    excluded: sql`count(*) filter (where status = 'excluded')::int`,
  }).from(migrationRecordsTable).where(eq(migrationRecordsTable.projectId, input.projectId));

  const row = result[0];
  return {
    all: Number(row?.all ?? 0),
    ready_for_approval: Number(row?.ready_for_approval ?? 0),
    rule_violations: Number(row?.rule_violations ?? 0),
    duplicates: Number(row?.duplicates ?? 0),
    needs_discussion: Number(row?.needs_discussion ?? 0),
    recommended_exclusions: Number(row?.recommended_exclusions ?? 0),
    ai_findings: Number(row?.ai_findings ?? 0),
    pending: Number(row?.pending ?? 0),
    approved: Number(row?.approved ?? 0),
    discussing: Number(row?.discussing ?? 0),
    consolidated: Number(row?.consolidated ?? 0),
    excluded: Number(row?.excluded ?? 0),
  };
}

export async function getRecord(input: { id: number }): Promise<RecordWithDiscussions | null> {
  const rows = await db.select().from(migrationRecordsTable).where(eq(migrationRecordsTable.id, input.id));
  if (!rows[0]) return null;
  // Fetch discussions where this record is either the primary record or in linked_record_ids
  const allDiscussions = await db.select().from(recordDiscussionsTable)
    .where(eq(recordDiscussionsTable.projectId, rows[0].projectId))
    .orderBy(recordDiscussionsTable.createdAt);
  const relevantDiscussions = allDiscussions.filter(d => {
    if (d.recordId === input.id) return true;
    const linked = (d.linkedRecordIds as number[] | null) ?? [];
    return linked.includes(input.id);
  });
  const allResponses = relevantDiscussions.length > 0
    ? await db.select().from(discussionResponsesTable)
        .where(inArray(discussionResponsesTable.discussionId, relevantDiscussions.map(d => d.id)))
        .orderBy(discussionResponsesTable.createdAt)
    : [];
  const discussionsWithResponses: DiscussionWithResponses[] = relevantDiscussions.map(d => ({
    ...d,
    responses: allResponses.filter(r => r.discussionId === d.id),
  }));
  return { ...rows[0], discussions: discussionsWithResponses };
}

export async function updateRecordStatus(input: {
  id: number;
  projectId: number;
  status: MigrationRecord['status'];
  reviewNote?: string;
  reason?: string;
}): Promise<MigrationRecord> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  // Load current record to check for no-op and get previous state
  const [existing] = await db.select().from(migrationRecordsTable)
    .where(and(eq(migrationRecordsTable.id, input.id), eq(migrationRecordsTable.projectId, input.projectId)));

  if (!existing) throw new Error('Record not found');

  // No-op guard: skip audit entry if already in that status
  if (existing.status === input.status) {
    return existing;
  }

  const previousState = existing.status;

  const [record] = await db.update(migrationRecordsTable)
    .set({
      status: input.status,
      reviewNote: input.reviewNote ?? null,
      reviewedById: user.id,
      reviewedAt: new Date(),
    })
    .where(and(eq(migrationRecordsTable.id, input.id), eq(migrationRecordsTable.projectId, input.projectId)))
    .returning();

  const actionMap: Record<string, string> = {
    approved: 'record_approved',
    excluded: 'record_excluded',
    discussing: 'record_flagged_for_discussion',
    consolidated: 'record_consolidated',
    pending: 'record_reset_to_pending',
  };

  await db.insert(auditLogTable).values({
    projectId: input.projectId,
    recordId: input.id,
    action: actionMap[input.status] ?? 'record_updated',
    details: input.reviewNote ?? input.reason ?? `Status changed to ${input.status}`,
    previousState,
    newState: input.status,
    reason: input.reason ?? input.reviewNote ?? null,
    performedById: user.id,
  });

  return record;
}

export interface BulkActionResult {
  success: true;
  updatedCount: number;
  recordIds: number[];
}

export async function bulkUpdateRecordStatus(input: {
  ids: number[];
  projectId: number;
  status: MigrationRecord['status'];
}): Promise<BulkActionResult> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  // Load existing records to skip no-ops
  const existingRecords = await db.select({ id: migrationRecordsTable.id, status: migrationRecordsTable.status })
    .from(migrationRecordsTable)
    .where(and(
      inArray(migrationRecordsTable.id, input.ids),
      eq(migrationRecordsTable.projectId, input.projectId)
    ));

  const toUpdate = existingRecords.filter(r => r.status !== input.status).map(r => r.id);
  if (toUpdate.length === 0) return { success: true, updatedCount: 0, recordIds: [] };

  await db.update(migrationRecordsTable)
    .set({ status: input.status, reviewedById: user.id, reviewedAt: new Date() })
    .where(and(
      inArray(migrationRecordsTable.id, toUpdate),
      eq(migrationRecordsTable.projectId, input.projectId)
    ));

  await db.insert(auditLogTable).values(
    toUpdate.map(recordId => ({
      projectId: input.projectId,
      recordId,
      action: input.status === 'approved' ? 'record_approved' : 'bulk_update',
      details: `Bulk action: status set to ${input.status} (${toUpdate.length} records)`,
      previousState: 'pending',
      newState: input.status,
      performedById: user.id,
    }))
  );

  return { success: true, updatedCount: toUpdate.length, recordIds: toUpdate };
}

export async function changeDisposition(input: {
  id: number;
  projectId: number;
  reason: string;
}): Promise<MigrationRecord> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const [existing] = await db.select().from(migrationRecordsTable)
    .where(and(eq(migrationRecordsTable.id, input.id), eq(migrationRecordsTable.projectId, input.projectId)));

  if (!existing) throw new Error('Record not found');

  const previousState = existing.status;

  const [record] = await db.update(migrationRecordsTable)
    .set({
      status: 'pending',
      reviewNote: null,
      reviewedById: user.id,
      reviewedAt: new Date(),
    })
    .where(and(eq(migrationRecordsTable.id, input.id), eq(migrationRecordsTable.projectId, input.projectId)))
    .returning();

  // Append audit event — original decision is preserved above it
  await db.insert(auditLogTable).values({
    projectId: input.projectId,
    recordId: input.id,
    action: 'disposition_changed',
    details: `Previous decision reversed: ${input.reason}`,
    previousState,
    newState: 'pending',
    reason: input.reason,
    performedById: user.id,
  });

  return record;
}

export async function addDiscussion(input: {
  recordId: number;
  projectId: number;
  content: string;
  title?: string;
  stakeholderId?: number;
  stakeholder?: string;
  notes?: string;
  findingRef?: string;
  linkedRecordIds?: number[];
  participants?: number[];
  notifyByEmail?: boolean;
}): Promise<RecordDiscussion> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const allLinkedIds = input.linkedRecordIds ?? [];

  const [discussion] = await db.insert(recordDiscussionsTable).values({
    recordId: input.recordId,
    projectId: input.projectId,
    content: input.content,
    title: input.title ?? null,
    stakeholderId: input.stakeholderId ?? null,
    stakeholder: input.stakeholder ?? null,
    notes: input.notes ?? null,
    findingRef: input.findingRef ?? null,
    linkedRecordIds: allLinkedIds.length > 0 ? allLinkedIds : [],
    participants: input.participants ?? [],
    notifyByEmail: input.notifyByEmail ?? false,
    discussionStatus: 'open',
    createdById: user.id,
  }).returning();

  // If bulk linked, mark ALL linked records as discussing
  const allAffectedIds = [input.recordId, ...allLinkedIds];
  if (allLinkedIds.length > 0) {
    await db.update(migrationRecordsTable)
      .set({ status: 'discussing', reviewedById: user.id, reviewedAt: new Date() })
      .where(and(
        inArray(migrationRecordsTable.id, allAffectedIds),
        eq(migrationRecordsTable.projectId, input.projectId),
      ));
  }

  // Audit log for discussion creation
  await db.insert(auditLogTable).values({
    projectId: input.projectId,
    recordId: input.recordId,
    action: 'discussion_created',
    details: input.title ? `Discussion: "${input.title}"` : 'Discussion item created',
    newState: 'discussing',
    linkedRecordIds: allLinkedIds.length > 0 ? allLinkedIds : null,
    actionContext: {
      discussionId: discussion.id,
      stakeholderId: input.stakeholderId ?? null,
      findingRef: input.findingRef ?? null,
      linkedRecordIds: allLinkedIds,
      participantUserIds: input.participants ?? [],
    },
    performedById: user.id,
  });

  // Create in-app notifications for participant app users
  if (input.participants && input.participants.length > 0) {
    try {
      const discussionTitle = input.title ?? input.content.slice(0, 80);
      const notifValues = input.participants
        .filter(uid => uid !== user.id) // Don't notify yourself
        .map(uid => ({
          userId: uid,
          projectId: input.projectId,
          discussionId: discussion.id,
          recordId: input.recordId,
          title: 'New discussion assigned',
          message: discussionTitle,
          isRead: false,
        }));
      if (notifValues.length > 0) {
        await db.insert(notificationsTable).values(notifValues);
      }
    } catch (err) {
      captureError(err as Error);
    }
  }

  // Send email notification to stakeholder if we have one AND (external stakeholder OR notifyByEmail is true)
  if (input.stakeholderId) {
    try {
      const [project] = await db.select().from(migrationProjectsTable)
        .where(eq(migrationProjectsTable.id, input.projectId));
      const [stakeholder] = await db.select().from(migrationStakeholdersTable)
        .where(eq(migrationStakeholdersTable.id, input.stakeholderId));
      const [record] = await db.select().from(migrationRecordsTable)
        .where(eq(migrationRecordsTable.id, input.recordId));

      // Send email if: external stakeholder (not app user) OR notifyByEmail opted in
      const shouldEmail = stakeholder && (!stakeholder.isAppUser || input.notifyByEmail);

      if (shouldEmail && stakeholder?.email && project && record) {
        const recordData = record.data as Record<string, unknown>;
        const linkedCount = allLinkedIds.length;
        const recordContext = linkedCount > 0
          ? `Row #${record.rowNumber} + ${linkedCount} other record${linkedCount !== 1 ? 's' : ''}`
          : `Row #${record.rowNumber} | ${Object.entries(recordData).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(' | ')}`;

        sendEmail({
          to: stakeholder.email,
          subject: `Clarification requested – ${project.name} migration`,
          contentType: 'text/html',
          body: renderDiscussionNotification({
            migrationName: project.name,
            stakeholderName: stakeholder.name,
            question: input.content,
            recordContext,
            discussionId: discussion.id,
            appUrl: `https://mergeflow.io/projects/${input.projectId}/review`,
          }),
        });

        await db.insert(auditLogTable).values({
          projectId: input.projectId,
          recordId: input.recordId,
          action: 'email_notification_sent',
          details: `Email sent to ${stakeholder.name} <${stakeholder.email}>`,
          actionContext: { discussionId: discussion.id, stakeholderId: stakeholder.id },
          performedById: user.id,
        });
      }
    } catch (err) {
      captureError(err as Error);
    }
  }

  return discussion;
}

export async function resolveDiscussion(input: {
  discussionId: number;
  projectId: number;
  recordId: number;
  resolution: string;
  nextDisposition?: MigrationRecord['status'];
}): Promise<RecordDiscussion> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const [discussion] = await db.update(recordDiscussionsTable)
    .set({
      discussionStatus: 'resolved',
      resolution: input.resolution,
      resolvedAt: new Date(),
      resolvedById: user.id,
    })
    .where(eq(recordDiscussionsTable.id, input.discussionId))
    .returning();

  await db.insert(auditLogTable).values({
    projectId: input.projectId,
    recordId: input.recordId,
    action: 'discussion_resolved',
    details: `Discussion resolved: ${input.resolution}`,
    actionContext: { discussionId: input.discussionId, resolution: input.resolution },
    performedById: user.id,
  });

  // If a next disposition is provided, update the record status
  if (input.nextDisposition) {
    const [existing] = await db.select().from(migrationRecordsTable)
      .where(eq(migrationRecordsTable.id, input.recordId));
    if (existing && existing.status !== input.nextDisposition) {
      await db.update(migrationRecordsTable)
        .set({ status: input.nextDisposition, reviewedById: user.id, reviewedAt: new Date() })
        .where(eq(migrationRecordsTable.id, input.recordId));
      const actionMap: Record<string, string> = {
        approved: 'record_approved',
        excluded: 'record_excluded',
        pending: 'record_returned_to_review',
      };
      await db.insert(auditLogTable).values({
        projectId: input.projectId,
        recordId: input.recordId,
        action: actionMap[input.nextDisposition] ?? 'record_updated',
        details: `Record ${input.nextDisposition} after discussion resolution`,
        previousState: existing.status,
        newState: input.nextDisposition,
        performedById: user.id,
      });
    }
  }

  return discussion;
}

export async function addDiscussionResponse(input: {
  discussionId: number;
  projectId: number;
  recordId: number;
  content: string;
  isInternal?: boolean;
}): Promise<DiscussionResponse> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const [response] = await db.insert(discussionResponsesTable).values({
    discussionId: input.discussionId,
    projectId: input.projectId,
    content: input.content,
    isInternal: input.isInternal ?? false,
    createdById: user.id,
  }).returning();

  await db.insert(auditLogTable).values({
    projectId: input.projectId,
    recordId: input.recordId,
    action: 'discussion_response_added',
    details: input.isInternal ? 'Internal note added to discussion' : 'Response added to discussion',
    actionContext: { discussionId: input.discussionId, responseId: response.id },
    performedById: user.id,
  });

  return response;
}

export async function getProjectStats(input: { projectId: number }): Promise<{
  total: number;
  pending: number;
  approved: number;
  excluded: number;
  discussing: number;
  consolidated: number;
  analyzed: number;
  withFinalDisposition: number;
}> {
  const [counts, analyzedResult] = await Promise.all([
    db.select({
      status: migrationRecordsTable.status,
      count: sql`count(*)::int`,
    })
      .from(migrationRecordsTable)
      .where(eq(migrationRecordsTable.projectId, input.projectId))
      .groupBy(migrationRecordsTable.status),
    db.select({
      analyzed: sql`count(*) filter (where recommended_disposition is not null)::int`,
    })
      .from(migrationRecordsTable)
      .where(eq(migrationRecordsTable.projectId, input.projectId)),
  ]);

  const result = { total: 0, pending: 0, approved: 0, excluded: 0, discussing: 0, consolidated: 0, analyzed: 0, withFinalDisposition: 0 };
  for (const row of counts) {
    const cnt = Number(row.count);
    result[row.status] = cnt;
    result.total += cnt;
  }
  result.analyzed = Number(analyzedResult[0]?.analyzed ?? 0);
  result.withFinalDisposition = result.approved + result.excluded + result.consolidated;
  return result;
}

export async function bulkExcludeRecords(input: {
  ids: number[];
  projectId: number;
  reason: string;
}): Promise<BulkActionResult> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const existingRecords = await db.select({ id: migrationRecordsTable.id, status: migrationRecordsTable.status })
    .from(migrationRecordsTable)
    .where(and(
      inArray(migrationRecordsTable.id, input.ids),
      eq(migrationRecordsTable.projectId, input.projectId),
    ));

  const toExclude = existingRecords.filter(r => r.status !== 'excluded').map(r => r.id);
  if (toExclude.length === 0) return { success: true, updatedCount: 0, recordIds: [] };

  await db.update(migrationRecordsTable)
    .set({ status: 'excluded', reviewNote: input.reason, reviewedById: user.id, reviewedAt: new Date() })
    .where(and(
      inArray(migrationRecordsTable.id, toExclude),
      eq(migrationRecordsTable.projectId, input.projectId),
    ));

  await db.insert(auditLogTable).values(
    toExclude.map(recordId => ({
      projectId: input.projectId,
      recordId,
      action: 'record_excluded',
      details: `Bulk exclusion: ${input.reason}`,
      previousState: 'pending',
      newState: 'excluded',
      reason: input.reason,
      performedById: user.id,
    }))
  );

  return { success: true, updatedCount: toExclude.length, recordIds: toExclude };
}

server.data('getRecords', getRecords);
server.data('getQueueCounts', getQueueCounts);
server.data('getRecord', getRecord);
server.data('updateRecordStatus', updateRecordStatus);
server.data('bulkUpdateRecordStatus', bulkUpdateRecordStatus);
server.data('changeDisposition', changeDisposition);
server.data('addDiscussion', addDiscussion);
server.data('resolveDiscussion', resolveDiscussion);
server.data('addDiscussionResponse', addDiscussionResponse);
server.data('getProjectStats', getProjectStats);
server.data('bulkExcludeRecords', bulkExcludeRecords);