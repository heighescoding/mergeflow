import { server, db, currentUser, captureError } from '@aha-app/builder-core';
import { eq, and, inArray } from 'drizzle-orm';
import {
  migrationRecordsTable,
  consolidationsTable,
  auditLogTable,
  type MigrationRecord,
  type Consolidation,
} from '@/db/schema';
import type { DuplicateMatch } from '@/data/analysis.server';

export interface ConsolidationCandidate {
  record: MigrationRecord;
  duplicateEvidence: DuplicateMatch[];
}

export interface ConsolidationCandidates {
  primaryRecord: MigrationRecord;
  candidateRecords: MigrationRecord[];
  matchingFields: Array<{ field: string; value: string; matchType: string }>;
  conflictingFields: Array<{ field: string; primaryValue: string; candidateValues: Array<{ recordId: number; value: string }> }>;
}

export async function getConsolidationCandidates(input: {
  recordId: number;
  projectId: number;
}): Promise<ConsolidationCandidates> {
  const [primary] = await db.select().from(migrationRecordsTable)
    .where(and(eq(migrationRecordsTable.id, input.recordId), eq(migrationRecordsTable.projectId, input.projectId)));

  if (!primary) throw new Error('Record not found');

  const dupEvidence = (primary.duplicateEvidence as DuplicateMatch[] | null) ?? [];
  const candidateIds = (primary.duplicateRecordIds as number[] | null) ?? dupEvidence.map(d => d.recordId).filter(Boolean);

  if (candidateIds.length === 0) {
    return {
      primaryRecord: primary,
      candidateRecords: [],
      matchingFields: [],
      conflictingFields: [],
    };
  }

  // Separate source record IDs (positive) from reference/destination IDs (negative)
  const sourceIds = candidateIds.filter((id): id is number => id > 0);
  const refIds = candidateIds.filter((id): id is number => id < 0);

  const sourceCandidates = sourceIds.length > 0
    ? await db.select().from(migrationRecordsTable).where(inArray(migrationRecordsTable.id, sourceIds))
    : [];

  // Build synthetic MigrationRecord objects for reference/destination records
  const refCandidates: MigrationRecord[] = refIds.map(refId => {
    const evidence = dupEvidence.find(d => d.recordId === refId);
    return {
      id: refId,
      projectId: input.projectId,
      sourceFileId: -1,
      rowNumber: evidence?.rowNumber ?? 0,
      data: (evidence?.referenceData ?? {}) as MigrationRecord['data'],
      status: 'pending' as const,
      aiConfidence: null,
      aiReasoning: null,
      aiIssueType: null,
      aiIssueSummary: null,
      validationErrors: null,
      destinationRuleFindings: null,
      aiAnalysisFindings: null,
      reviewedById: null,
      reviewedAt: null,
      reviewNote: 'Destination system record (existing)',
      recommendedDisposition: null,
      recommendedDispositionReason: null,
      duplicateRecordIds: null,
      duplicateConfidence: null,
      duplicateEvidence: null,
      suggestedQuestion: null,
      createdAt: new Date(),
    };
  });

  const candidates = [...sourceCandidates, ...refCandidates];

  // Build matching/conflicting field analysis from evidence
  const firstMatch = dupEvidence[0];
  const matchingFields = firstMatch?.matchingFields ?? [];
  const conflictingFields: ConsolidationCandidates['conflictingFields'] = [];

  // Aggregate conflicting fields across all candidates
  const conflictMap: Record<string, { primary: string; candidates: Array<{ recordId: number; value: string }> }> = {};
  const primaryData = primary.data as Record<string, unknown>;

  for (const candidate of candidates) {
    const evidence = dupEvidence.find(d => d.recordId === candidate.id);
    const candidateData = candidate.data as Record<string, unknown>;
    for (const cf of (evidence?.conflictingFields ?? [])) {
      if (!conflictMap[cf.field]) {
        conflictMap[cf.field] = {
          primary: String(primaryData[cf.field] ?? ''),
          candidates: [],
        };
      }
      conflictMap[cf.field].candidates.push({
        recordId: candidate.id,
        value: String(candidateData[cf.field] ?? ''),
      });
    }
  }

  for (const [field, data] of Object.entries(conflictMap)) {
    conflictingFields.push({
      field,
      primaryValue: data.primary,
      candidateValues: data.candidates,
    });
  }

  return {
    primaryRecord: primary,
    candidateRecords: candidates,
    matchingFields,
    conflictingFields,
  };
}

export interface FinalizeConsolidationInput {
  projectId: number;
  survivingRecordId: number;
  mergedRecordIds: number[];
  fieldSelections: Record<string, { value: unknown; fromRecordId: number }>;
  reason: string;
}

export async function finalizeConsolidation(input: FinalizeConsolidationInput): Promise<Consolidation> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  // For source-to-destination: survivingRecordId is negative (destination system record)
  const isDestinationSurviving = input.survivingRecordId < 0;

  // Only load positive IDs that exist in migrationRecordsTable
  const positiveIds = [
    ...(isDestinationSurviving ? [] : [input.survivingRecordId]),
    ...input.mergedRecordIds.filter(id => id > 0),
  ];
  const records = positiveIds.length > 0
    ? await db.select().from(migrationRecordsTable)
        .where(and(inArray(migrationRecordsTable.id, positiveIds), eq(migrationRecordsTable.projectId, input.projectId)))
    : [];

  if (!isDestinationSurviving) {
    // Source-to-source: update surviving source record with merged data
    const surviving = records.find(r => r.id === input.survivingRecordId);
    if (!surviving) throw new Error('Surviving record not found');

    const survivingData = { ...(surviving.data as Record<string, unknown>) };
    for (const [field, sel] of Object.entries(input.fieldSelections)) {
      survivingData[field] = sel.value;
    }

    await db.update(migrationRecordsTable)
      .set({
        data: survivingData,
        status: 'pending',
        reviewedById: user.id,
        reviewedAt: new Date(),
        reviewNote: `Consolidated from records: ${input.mergedRecordIds.filter(id => id > 0).join(', ')}. ${input.reason}`,
      })
      .where(eq(migrationRecordsTable.id, input.survivingRecordId));
  }
  // For source-to-destination: the destination record survives externally — no local record update needed

  // Mark source records as consolidated (positive IDs only — reference records have no DB row)
  const sourceMergedIds = input.mergedRecordIds.filter(id => id > 0);
  if (sourceMergedIds.length > 0) {
    const survivorDesc = isDestinationSurviving
      ? 'existing destination system record'
      : `record #${input.survivingRecordId}`;
    await db.update(migrationRecordsTable)
      .set({
        status: 'consolidated',
        reviewNote: `Merged into ${survivorDesc}. ${input.reason}`,
        reviewedById: user.id,
        reviewedAt: new Date(),
      })
      .where(and(
        inArray(migrationRecordsTable.id, sourceMergedIds),
        eq(migrationRecordsTable.projectId, input.projectId)
      ));
  }

  // Record the consolidation event
  const [consolidation] = await db.insert(consolidationsTable).values({
    projectId: input.projectId,
    survivingRecordId: input.survivingRecordId,
    mergedRecordIds: input.mergedRecordIds,
    fieldSelections: input.fieldSelections,
    reason: input.reason,
    performedById: user.id,
  }).returning();

  // Audit log — append-only
  const auditRows: Array<{
    projectId: number;
    recordId: number;
    action: string;
    details: string;
    newState: string;
    previousState: string;
    reason: string;
    linkedRecordIds: number[];
    actionContext: Record<string, unknown>;
    performedById: number;
  }> = [];

  if (!isDestinationSurviving) {
    const surviving = records.find(r => r.id === input.survivingRecordId);
    auditRows.push({
      projectId: input.projectId,
      recordId: input.survivingRecordId,
      action: 'consolidation_survivor',
      details: `Surviving record in consolidation. Merged from: ${sourceMergedIds.join(', ')}. Reason: ${input.reason}`,
      newState: 'pending',
      previousState: surviving?.status ?? 'pending',
      reason: input.reason,
      linkedRecordIds: sourceMergedIds,
      actionContext: { consolidationId: consolidation.id, fieldSelections: input.fieldSelections },
      performedById: user.id,
    });
  }

  for (const mergedId of sourceMergedIds) {
    const mergedRecord = records.find(r => r.id === mergedId);
    const survivorDesc = isDestinationSurviving
      ? 'existing destination system record'
      : `record #${input.survivingRecordId}`;
    auditRows.push({
      projectId: input.projectId,
      recordId: mergedId,
      action: 'consolidation_merged',
      details: `Record consolidated into ${survivorDesc}. Original data preserved. Reason: ${input.reason}`,
      newState: 'consolidated',
      previousState: mergedRecord?.status ?? 'pending',
      reason: input.reason,
      linkedRecordIds: [input.survivingRecordId],
      actionContext: {
        consolidationId: consolidation.id,
        matchCategory: isDestinationSurviving ? 'source_to_destination' : 'source_to_source',
      },
      performedById: user.id,
    });
  }

  if (auditRows.length > 0) {
    await db.insert(auditLogTable).values(auditRows);
  }

  return consolidation;
}

export async function getConsolidationsForProject(input: { projectId: number }): Promise<Consolidation[]> {
  return db.select().from(consolidationsTable)
    .where(eq(consolidationsTable.projectId, input.projectId));
}

server.data('getConsolidationCandidates', getConsolidationCandidates);
server.data('finalizeConsolidation', finalizeConsolidation);
server.data('getConsolidationsForProject', getConsolidationsForProject);