import { server, db, currentUser, captureError } from '@aha-app/builder-core';
import { eq, and, inArray } from 'drizzle-orm';
import {
  migrationValuesTable,
  migrationRecordsTable,
  destinationFieldsTable,
  auditLogTable,
  type MigrationRecord,
  type MigrationValue,
} from '@/db/schema';
import type { RuleFinding } from '@/data/analysis.server';

// Inline deterministic validation logic (mirrors analysis.server.ts validateRecord)
function validateRecordLocal(
  data: Record<string, unknown>,
  confirmedFields: Array<{
    fieldName: string;
    fieldType: string;
    required: boolean;
    isUnique: boolean;
    sourceMapping: string | null;
    allowedValues: string[] | null;
  }>,
): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const field of confirmedFields) {
    const sourceKey =
      field.sourceMapping ||
      Object.keys(data).find(
        k => k.toLowerCase().replace(/[\s_-]/g, '') === field.fieldName.toLowerCase().replace(/[\s_-]/g, '')
      ) ||
      null;
    const value = sourceKey != null ? data[sourceKey] : undefined;
    const isEmpty = value === null || value === undefined || value === '';
    if (field.required && isEmpty) {
      findings.push({ findingSource: 'destination_rule', field: field.fieldName, rule: 'required', sourceValue: null, expectedValue: 'non-empty value', explanation: `${field.fieldName} is a confirmed required destination field but the source record has no value.`, severity: 'error', status: 'open' });
      continue;
    }
    if (isEmpty) continue;
    const strValue = String(value);
    if (field.fieldType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strValue)) {
      findings.push({ findingSource: 'destination_rule', field: field.fieldName, rule: 'email_format', sourceValue: strValue, expectedValue: 'valid email address', explanation: `${field.fieldName} must be a valid email address.`, severity: 'error', status: 'open' });
    }
    if (field.fieldType === 'number' && isNaN(Number(value))) {
      findings.push({ findingSource: 'destination_rule', field: field.fieldName, rule: 'data_type', sourceValue: strValue, expectedValue: 'number', explanation: `${field.fieldName} must be a number; received "${strValue}".`, severity: 'error', status: 'open' });
    }
    if (field.fieldType === 'date' && isNaN(Date.parse(strValue))) {
      findings.push({ findingSource: 'destination_rule', field: field.fieldName, rule: 'data_type', sourceValue: strValue, expectedValue: 'valid date', explanation: `${field.fieldName} must be a valid date; received "${strValue}".`, severity: 'error', status: 'open' });
    }
    if (field.allowedValues && field.allowedValues.length > 0 && !field.allowedValues.includes(strValue)) {
      findings.push({ findingSource: 'destination_rule', field: field.fieldName, rule: 'allowed_values', sourceValue: strValue, expectedValue: field.allowedValues.join(' | '), explanation: `${field.fieldName} must be one of the confirmed allowed values: ${field.allowedValues.join(', ')}. Received "${strValue}".`, severity: 'error', status: 'open' });
    }
  }
  return findings;
}

export type { MigrationValue };

export async function getMigrationValues(input: {
  recordId: number;
}): Promise<MigrationValue[]> {
  return db.select().from(migrationValuesTable).where(eq(migrationValuesTable.recordId, input.recordId));
}

export async function setMigrationValue(input: {
  recordId: number;
  projectId: number;
  fieldName: string;
  migrationValue: string;
  reason: string;
  discussionId?: number;
}): Promise<{ record: MigrationRecord; migrationValue: MigrationValue }> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  // Load the current record
  const [record] = await db.select().from(migrationRecordsTable)
    .where(and(eq(migrationRecordsTable.id, input.recordId), eq(migrationRecordsTable.projectId, input.projectId)));
  if (!record) throw new Error('Record not found');

  const sourceData = record.data as Record<string, unknown>;

  // Determine the original source value for this field
  const confirmedFields = await db.select().from(destinationFieldsTable)
    .where(and(eq(destinationFieldsTable.projectId, input.projectId), eq(destinationFieldsTable.isConfirmed, true)));

  const destField = confirmedFields.find(f => f.fieldName === input.fieldName);
  const sourceMapping = destField?.sourceMapping ?? null;
  const sourceKey = sourceMapping ?? Object.keys(sourceData).find(
    k => k.toLowerCase().replace(/[\s_-]/g, '') === input.fieldName.toLowerCase().replace(/[\s_-]/g, '')
  ) ?? null;
  const originalSourceValue = sourceKey ? String(sourceData[sourceKey] ?? '') : null;

  // Upsert the migration value (one row per record+field)
  const [existing] = await db.select().from(migrationValuesTable)
    .where(and(eq(migrationValuesTable.recordId, input.recordId), eq(migrationValuesTable.fieldName, input.fieldName)));

  let mv: MigrationValue;
  if (existing) {
    const [updated] = await db.update(migrationValuesTable)
      .set({
        previousMigrationValue: existing.migrationValue,
        migrationValue: input.migrationValue,
        changedById: user.id,
        changedAt: new Date(),
        reason: input.reason,
        discussionId: input.discussionId ?? existing.discussionId,
      })
      .where(eq(migrationValuesTable.id, existing.id))
      .returning();
    mv = updated;
  } else {
    const [inserted] = await db.insert(migrationValuesTable).values({
      recordId: input.recordId,
      projectId: input.projectId,
      fieldName: input.fieldName,
      originalSourceValue,
      migrationValue: input.migrationValue,
      previousMigrationValue: null,
      changedById: user.id,
      changedAt: new Date(),
      reason: input.reason,
      discussionId: input.discussionId ?? null,
    }).returning();
    mv = inserted;
  }

  // Audit: migration value changed
  await db.insert(auditLogTable).values({
    projectId: input.projectId,
    recordId: input.recordId,
    action: 'migration_value_changed',
    details: `Migration value for "${input.fieldName}" set to "${input.migrationValue}"`,
    previousState: existing?.migrationValue ?? originalSourceValue ?? '(missing)',
    newState: input.migrationValue,
    reason: input.reason,
    actionContext: {
      fieldName: input.fieldName,
      originalSourceValue,
      previousMigrationValue: existing?.migrationValue ?? null,
      newMigrationValue: input.migrationValue,
      discussionId: input.discussionId ?? null,
    },
    performedById: user.id,
  });

  // Re-run deterministic validation using effective data (source + overrides)
  const updatedRecord = await revalidateRecordInternal(record, confirmedFields, input.projectId, user.id);

  return { record: updatedRecord, migrationValue: mv };
}

// Internal: revalidates a record after migration value changes.
// Gets all migration values for the record, builds effective data, reruns rules.
async function revalidateRecordInternal(
  record: MigrationRecord,
  confirmedFields: Array<{
    id: number;
    fieldName: string;
    fieldType: string;
    required: boolean;
    isUnique: boolean;
    sourceMapping: string | null;
    allowedValues: string[] | null;
  }>,
  projectId: number,
  performedById: number,
): Promise<MigrationRecord> {
  // Load all migration values for this record
  const migrationValues = await db.select().from(migrationValuesTable)
    .where(eq(migrationValuesTable.recordId, record.id));

  // Build effective data: start with source, then apply overrides
  const sourceData = record.data as Record<string, unknown>;
  const effectiveData: Record<string, unknown> = { ...sourceData };

  for (const mv of migrationValues) {
    // Find the source key for this field
    const destField = confirmedFields.find(f => f.fieldName === mv.fieldName);
    const sourceKey = destField?.sourceMapping ?? Object.keys(sourceData).find(
      k => k.toLowerCase().replace(/[\s_-]/g, '') === mv.fieldName.toLowerCase().replace(/[\s_-]/g, '')
    ) ?? mv.fieldName;
    // Apply the migration value override to the effective data
    effectiveData[sourceKey] = mv.migrationValue;
  }

  // Run deterministic validation against effective data
  const ruleFindings = validateRecordLocal(effectiveData, confirmedFields.map(f => ({
    fieldName: f.fieldName,
    fieldType: f.fieldType,
    required: f.required,
    isUnique: f.isUnique,
    sourceMapping: f.sourceMapping,
    allowedValues: f.allowedValues,
  })));

  // Determine new recommended disposition based on findings + existing AI findings
  const aiFindings = (record.aiAnalysisFindings as Array<{ severity: string }> | null) ?? [];
  const aiWarnings = aiFindings.filter(f => f.severity === 'warning');
  const hadViolations = (record.destinationRuleFindings as unknown[] | null)?.length ?? 0;

  let newDisposition = record.recommendedDisposition;
  if (ruleFindings.length === 0 && hadViolations > 0) {
    // Violations cleared — recalculate disposition
    if (aiWarnings.length > 0) {
      newDisposition = 'needs_manual_review';
    } else if ((record.aiConfidence ?? 0) >= 0.7) {
      newDisposition = 'ready_for_approval';
    } else {
      newDisposition = 'ready_for_approval'; // default when violations cleared
    }
  }

  const [updatedRecord] = await db.update(migrationRecordsTable)
    .set({
      destinationRuleFindings: ruleFindings.length > 0 ? ruleFindings : null,
      recommendedDisposition: newDisposition,
    })
    .where(eq(migrationRecordsTable.id, record.id))
    .returning();

  // Audit: revalidation result
  if (ruleFindings.length === 0 && hadViolations > 0) {
    await db.insert(auditLogTable).values({
      projectId,
      recordId: record.id,
      action: 'rule_violation_resolved',
      details: `All rule violations cleared after migration value correction. Record is now ${newDisposition?.replace(/_/g, ' ')}.`,
      previousState: 'rule_violations',
      newState: newDisposition ?? 'ready_for_approval',
      performedById,
    });
  } else if (ruleFindings.length > 0) {
    await db.insert(auditLogTable).values({
      projectId,
      recordId: record.id,
      action: 'record_revalidated',
      details: `Revalidation after migration value change: ${ruleFindings.length} violation(s) remain.`,
      actionContext: { remainingViolations: ruleFindings.map(f => f.field) },
      performedById,
    });
  }

  return updatedRecord;
}

export async function revalidateRecord(input: { recordId: number; projectId: number }): Promise<MigrationRecord> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const [record] = await db.select().from(migrationRecordsTable)
    .where(and(eq(migrationRecordsTable.id, input.recordId), eq(migrationRecordsTable.projectId, input.projectId)));
  if (!record) throw new Error('Record not found');

  const confirmedFields = await db.select().from(destinationFieldsTable)
    .where(and(eq(destinationFieldsTable.projectId, input.projectId), eq(destinationFieldsTable.isConfirmed, true)));

  return revalidateRecordInternal(record, confirmedFields, input.projectId, user.id);
}

// Get migration values for multiple records at once (for export)
export async function getMigrationValuesForRecords(input: {
  recordIds: number[];
  projectId: number;
}): Promise<MigrationValue[]> {
  if (input.recordIds.length === 0) return [];
  return db.select().from(migrationValuesTable)
    .where(and(
      inArray(migrationValuesTable.recordId, input.recordIds),
      eq(migrationValuesTable.projectId, input.projectId),
    ));
}

server.data('getMigrationValues', getMigrationValues);
server.data('setMigrationValue', setMigrationValue);
server.data('revalidateRecord', revalidateRecord);