import { server, db, currentUser } from '@aha-app/builder-core';
import { eq, and, inArray } from 'drizzle-orm';
import {
  migrationRecordsTable,
  destinationFieldsTable,
  migrationProjectsTable,
  auditLogTable,
  recordDiscussionsTable,
  consolidationsTable,
  usersTable,
  migrationStakeholdersTable,
  migrationValuesTable,
} from '@/db/schema';

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  return str.includes(',') || str.includes('"') || str.includes('\n')
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}

function formatIso(ts: Date | null | undefined): string {
  if (!ts) return '';
  return ts instanceof Date ? ts.toISOString() : new Date(ts).toISOString();
}

// ---------------------------------------------------------------------------
// exportApprovedRecords — approved migration CSV (destination fields only)
// ---------------------------------------------------------------------------
export async function exportApprovedRecords(input: {
  projectId: number;
}): Promise<{ csv: string; filename: string; count: number }> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const [project, fields, records] = await Promise.all([
    db.select().from(migrationProjectsTable).where(eq(migrationProjectsTable.id, input.projectId)).then(r => r[0]),
    db.select().from(destinationFieldsTable)
      .where(eq(destinationFieldsTable.projectId, input.projectId))
      .orderBy(destinationFieldsTable.sortOrder),
    db.select().from(migrationRecordsTable)
      .where(and(
        eq(migrationRecordsTable.projectId, input.projectId),
        eq(migrationRecordsTable.status, 'approved'),
      )),
  ]);

  // Only include fields that are mapped to a source column — no source-only fields
  const mappedFields = fields.filter(f => f.sourceMapping && f.sourceMapping.trim() !== '');

  const headers = mappedFields.length > 0
    ? mappedFields.map(f => f.fieldName)
    : records.length > 0
      ? Object.keys(records[0].data as Record<string, unknown>)
      : [];

  // Load migration value overrides for all approved records
  const recordIds = records.map(r => r.id);
  const migOverrides = recordIds.length > 0
    ? await db.select().from(migrationValuesTable).where(inArray(migrationValuesTable.recordId, recordIds))
    : [];

  const csvRows = [headers.join(',')];
  for (const record of records) {
    const data = record.data as Record<string, unknown>;
    const recordOverrides = migOverrides.filter(mv => mv.recordId === record.id);
    const row = headers.map(header => {
      const field = mappedFields.find(f => f.fieldName === header);
      // Use migration value override if one exists for this destination field
      const override = recordOverrides.find(mv => mv.fieldName === header);
      if (override) return csvEscape(override.migrationValue);
      const value = field?.sourceMapping ? data[field.sourceMapping] : data[header];
      return csvEscape(value);
    });
    csvRows.push(row.join(','));
  }

  const filename = `${(project?.name ?? 'migration').replace(/\s+/g, '_')}_approved_${new Date().toISOString().split('T')[0]}.csv`;

  return { csv: csvRows.join('\n'), filename, count: records.length };
}

// ---------------------------------------------------------------------------
// getApprovedRecordsData — structured data for Excel export
// ---------------------------------------------------------------------------
export async function getApprovedRecordsData(input: {
  projectId: number;
}): Promise<{
  projectName: string;
  headers: string[];
  rows: (string | number | null)[][];
  count: number;
}> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const [project, fields, records] = await Promise.all([
    db.select().from(migrationProjectsTable).where(eq(migrationProjectsTable.id, input.projectId)).then(r => r[0]),
    db.select().from(destinationFieldsTable)
      .where(eq(destinationFieldsTable.projectId, input.projectId))
      .orderBy(destinationFieldsTable.sortOrder),
    db.select().from(migrationRecordsTable)
      .where(and(
        eq(migrationRecordsTable.projectId, input.projectId),
        eq(migrationRecordsTable.status, 'approved'),
      )),
  ]);

  const mappedFields = fields.filter(f => f.sourceMapping && f.sourceMapping.trim() !== '');

  const headers = mappedFields.length > 0
    ? mappedFields.map(f => f.fieldName)
    : records.length > 0
      ? Object.keys(records[0].data as Record<string, unknown>)
      : [];

  // Load migration value overrides for all approved records
  const recordIds2 = records.map(r => r.id);
  const migOverrides2 = recordIds2.length > 0
    ? await db.select().from(migrationValuesTable).where(inArray(migrationValuesTable.recordId, recordIds2))
    : [];

  const rows = records.map(record => {
    const data = record.data as Record<string, unknown>;
    const recordOverrides = migOverrides2.filter(mv => mv.recordId === record.id);
    return headers.map(header => {
      const field = mappedFields.find(f => f.fieldName === header);
      // Use migration value override if one exists for this destination field
      const override = recordOverrides.find(mv => mv.fieldName === header);
      if (override) return override.migrationValue ?? null;
      const value = field?.sourceMapping ? data[field.sourceMapping] : data[header];
      if (value === null || value === undefined) return null;
      if (typeof value === 'number') return value;
      return String(value);
    });
  });

  return {
    projectName: project?.name ?? 'Migration',
    headers,
    rows,
    count: records.length,
  };
}

// ---------------------------------------------------------------------------
// getAuditWorkbookData — structured data for the 3-sheet audit workbook
// ---------------------------------------------------------------------------
export async function getAuditWorkbookData(input: {
  projectId: number;
}): Promise<{
  projectName: string;
  recordSummary: { headers: string[]; rows: (string | number | null)[][] };
  decisionAudit: { headers: string[]; rows: (string | number | null)[][] };
  discussions: { headers: string[]; rows: (string | number | null)[][] };
}> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const [project, records, auditEntries, discussions, consolidations, allUsers, stakeholders] = await Promise.all([
    db.select().from(migrationProjectsTable).where(eq(migrationProjectsTable.id, input.projectId)).then(r => r[0]),
    db.select().from(migrationRecordsTable).where(eq(migrationRecordsTable.projectId, input.projectId)),
    db.select({
      id: auditLogTable.id,
      recordId: auditLogTable.recordId,
      action: auditLogTable.action,
      details: auditLogTable.details,
      previousState: auditLogTable.previousState,
      newState: auditLogTable.newState,
      reason: auditLogTable.reason,
      linkedRecordIds: auditLogTable.linkedRecordIds,
      createdAt: auditLogTable.createdAt,
      userEmail: usersTable.email,
      userFirstName: usersTable.firstName,
      userLastName: usersTable.lastName,
    })
      .from(auditLogTable)
      .leftJoin(usersTable, eq(auditLogTable.performedById, usersTable.id))
      .where(eq(auditLogTable.projectId, input.projectId))
      .orderBy(auditLogTable.createdAt),
    db.select().from(recordDiscussionsTable).where(eq(recordDiscussionsTable.projectId, input.projectId)),
    db.select().from(consolidationsTable).where(eq(consolidationsTable.projectId, input.projectId)),
    db.select().from(usersTable),
    db.select().from(migrationStakeholdersTable).where(eq(migrationStakeholdersTable.projectId, input.projectId)),
  ]);

  // Build lookup maps
  const auditByRecord: Record<number, typeof auditEntries> = {};
  for (const entry of auditEntries) {
    if (entry.recordId) {
      (auditByRecord[entry.recordId] ??= []).push(entry);
    }
  }

  const discussionsByRecord: Record<number, typeof discussions> = {};
  for (const d of discussions) {
    (discussionsByRecord[d.recordId] ??= []).push(d);
  }

  const consolidationBySurvivor: Record<number, typeof consolidations[0]> = {};
  const consolidationByMerged: Record<number, number> = {};
  for (const c of consolidations) {
    consolidationBySurvivor[c.survivingRecordId] = c;
    for (const mergedId of (c.mergedRecordIds as number[])) {
      consolidationByMerged[mergedId] = c.survivingRecordId;
    }
  }

  const userById: Record<number, typeof allUsers[0]> = {};
  for (const u of allUsers) userById[u.id] = u;

  const stakeholderById: Record<number, typeof stakeholders[0]> = {};
  for (const s of stakeholders) stakeholderById[s.id] = s;

  function userName(id: number | null | undefined): string {
    if (!id) return '';
    const u = userById[id];
    if (!u) return String(id);
    return u.firstName ? `${u.firstName} ${u.lastName ?? ''}`.trim() : u.email;
  }

  // ── Sheet 1: Record Summary ──────────────────────────────────────────────
  const summaryHeaders = [
    'Record ID',
    'Source Row',
    'Final Disposition',
    'Final Destination / Surviving Record',
    'Recommended Disposition',
    'AI Confidence',
    'Destination Rule Findings',
    'Contextual Findings Summary',
    'Final Review Notes',
    'Finalized By',
    'Finalized At',
    'Consolidation Status',
    'Consolidation Lineage',
    'Open Discussions',
    'Resolved Discussions',
  ];

  const summaryRows = records.map(record => {
    const history = auditByRecord[record.id] ?? [];
    const recordDiscList = discussionsByRecord[record.id] ?? [];
    const openDisc = recordDiscList.filter(d => d.discussionStatus === 'open').length;
    const resolvedDisc = recordDiscList.filter(d => d.discussionStatus === 'resolved').length;

    const isSurvivor = !!consolidationBySurvivor[record.id];
    const mergedIntoId = consolidationByMerged[record.id];
    const cons = consolidationBySurvivor[record.id];

    const consolidationStatus = isSurvivor
      ? 'Survivor (others merged into this record)'
      : mergedIntoId
        ? `Merged into Record #${mergedIntoId}`
        : '';

    const consolidationLineage = isSurvivor && cons
      ? `Merged from: ${(cons.mergedRecordIds as number[]).map(id => `#${id}`).join(', ')}${cons.reason ? ` — ${cons.reason}` : ''}`
      : '';

    const finalDestination = isSurvivor
      ? `Record #${record.id} (survivor)`
      : mergedIntoId
        ? `Record #${mergedIntoId}`
        : '';

    // Destination rule findings — human-readable summary
    const ruleFindings = record.destinationRuleFindings as { field?: string; rule?: string; message?: string }[] | null;
    const ruleSummary = ruleFindings && ruleFindings.length > 0
      ? ruleFindings.map(f => f.message ?? `${f.field}: ${f.rule}`).join('; ')
      : '';

    // AI findings summary
    const aiFindings = record.aiAnalysisFindings as { summary?: string; type?: string }[] | null;
    const aiSummary = record.aiIssueSummary ??
      (aiFindings && aiFindings.length > 0 ? aiFindings.map(f => f.summary ?? f.type).join('; ') : '');

    return [
      record.id,
      record.rowNumber,
      record.status,
      finalDestination,
      record.recommendedDisposition ?? '',
      record.aiConfidence !== null && record.aiConfidence !== undefined
        ? Math.round(record.aiConfidence * 100) / 100
        : null,
      ruleSummary,
      aiSummary ?? '',
      record.reviewNote ?? '',
      userName(record.reviewedById),
      formatIso(record.reviewedAt),
      consolidationStatus,
      consolidationLineage,
      openDisc,
      resolvedDisc,
    ] as (string | number | null)[];
  });

  // ── Sheet 2: Decision Audit Trail ────────────────────────────────────────
  const auditHeaders = [
    'Record ID',
    'Action',
    'Actor',
    'Timestamp',
    'Previous State',
    'New State',
    'Reason / Details',
    'Linked Records',
    'Discussion ID',
  ];

  const auditRows = auditEntries.map(entry => {
    const actorName = entry.userFirstName
      ? `${entry.userFirstName} ${entry.userLastName ?? ''}`.trim()
      : (entry.userEmail ?? 'Unknown');
    const linkedIds = entry.linkedRecordIds
      ? (entry.linkedRecordIds as number[]).map(id => `#${id}`).join(', ')
      : '';
    // Try to extract discussion id from actionContext if present
    const ctx = entry as { actionContext?: { discussionId?: number } };
    const discussionId = ctx.actionContext?.discussionId ?? null;

    return [
      entry.recordId ?? null,
      entry.action,
      actorName,
      formatIso(entry.createdAt),
      entry.previousState ?? '',
      entry.newState ?? '',
      entry.reason ?? entry.details ?? '',
      linkedIds,
      discussionId,
    ] as (string | number | null)[];
  });

  // ── Sheet 3: Discussions & Resolutions ───────────────────────────────────
  const discHeaders = [
    'Record ID',
    'Discussion ID',
    'Status',
    'Question / Title',
    'Responsible Stakeholder',
    'Organization',
    'Role',
    'Notes',
    'Resolution',
    'Opened By',
    'Opened At',
    'Resolved By',
    'Resolved At',
  ];

  const discRows = discussions.map(d => {
    const stakeholder = d.stakeholderId ? stakeholderById[d.stakeholderId] : null;
    const stakeholderName = stakeholder?.name ?? d.stakeholder ?? '';
    const stakeholderOrg = stakeholder?.organization ?? '';
    const stakeholderRole = stakeholder?.role ?? '';
    const resolverName = userName(d.resolvedById);

    return [
      d.recordId,
      d.id,
      d.discussionStatus,
      d.title ?? d.content,
      stakeholderName,
      stakeholderOrg,
      stakeholderRole,
      d.notes ?? '',
      d.resolution ?? '',
      userName(d.createdById),
      formatIso(d.createdAt),
      resolverName,
      formatIso(d.resolvedAt),
    ] as (string | number | null)[];
  });

  return {
    projectName: project?.name ?? 'Migration',
    recordSummary: { headers: summaryHeaders, rows: summaryRows },
    decisionAudit: { headers: auditHeaders, rows: auditRows },
    discussions: { headers: discHeaders, rows: discRows },
  };
}

server.data('exportApprovedRecords', exportApprovedRecords);
server.data('getApprovedRecordsData', getApprovedRecordsData);
server.data('getAuditWorkbookData', getAuditWorkbookData);