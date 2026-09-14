import { server, db, currentUser, ai } from '@aha-app/builder-core';
import { eq, and, asc } from 'drizzle-orm';
import {
  destinationFieldsTable,
  validationRulesTable,
  migrationProjectsTable,
  auditLogTable,
  type DestinationField,
  type NewDestinationField,
  type ValidationRule,
  type NewValidationRule,
} from '@/db/schema';
import { captureError } from '@aha-app/builder-core';

export async function getDestinationFields(input: { projectId: number }): Promise<DestinationField[]> {
  return db.select().from(destinationFieldsTable)
    .where(eq(destinationFieldsTable.projectId, input.projectId))
    .orderBy(asc(destinationFieldsTable.sortOrder), asc(destinationFieldsTable.id));
}

function normalizeFieldName(name: string): string {
  return name.toLowerCase().replace(/[\s_-]/g, '');
}

export async function createDestinationField(input: {
  projectId: number;
  fieldName: string;
  fieldType: DestinationField['fieldType'];
  required: boolean;
  isUnique?: boolean;
  sourceMapping?: string;
  allowedValues?: string[];
  description?: string;
  requirementSource?: DestinationField['requirementSource'];
  isConfirmed?: boolean;
}): Promise<DestinationField> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const existing = await db.select().from(destinationFieldsTable)
    .where(eq(destinationFieldsTable.projectId, input.projectId));

  // Prevent duplicate normalized field names
  const normalizedNew = normalizeFieldName(input.fieldName.trim());
  const duplicate = existing.find(f => normalizeFieldName(f.fieldName) === normalizedNew);
  if (duplicate) {
    throw new Error(
      `A requirement named "${duplicate.fieldName}" already exists for this migration. Requirement names must be unique (case-insensitive).`
    );
  }

  const isManual = (input.requirementSource ?? 'manual') === 'manual';
  const isConfirmed = input.isConfirmed !== undefined ? input.isConfirmed : isManual;
  const status: DestinationField['status'] = input.sourceMapping ? 'mapped' : 'missing';

  const [field] = await db.insert(destinationFieldsTable).values({
    projectId: input.projectId,
    fieldName: input.fieldName,
    fieldType: input.fieldType,
    required: input.required,
    isUnique: input.isUnique ?? false,
    sourceMapping: input.sourceMapping ?? null,
    allowedValues: input.allowedValues ?? null,
    description: input.description ?? null,
    status,
    requirementSource: input.requirementSource ?? 'manual',
    isConfirmed,
    confirmedById: isConfirmed ? user.id : null,
    confirmedAt: isConfirmed ? new Date() : null,
    sortOrder: existing.length,
  }).returning();

  // If manually confirmed, mark analysis outdated
  if (isConfirmed) {
    await db.update(migrationProjectsTable)
      .set({ analysisOutdated: true, updatedAt: new Date() })
      .where(eq(migrationProjectsTable.id, input.projectId));
  }

  return field;
}

export async function updateDestinationField(input: {
  id: number;
  projectId: number;
  fieldName?: string;
  fieldType?: DestinationField['fieldType'];
  required?: boolean;
  isUnique?: boolean;
  sourceMapping?: string | null;
  allowedValues?: string[] | null;
  description?: string | null;
  status?: DestinationField['status'];
}): Promise<DestinationField> {
  const { id, projectId, ...fields } = input;
  const updateData: Partial<NewDestinationField> = {};
  if (fields.fieldName !== undefined) updateData.fieldName = fields.fieldName;
  if (fields.fieldType !== undefined) updateData.fieldType = fields.fieldType;
  if (fields.required !== undefined) updateData.required = fields.required;
  if (fields.isUnique !== undefined) updateData.isUnique = fields.isUnique;
  if ('sourceMapping' in fields) {
    updateData.sourceMapping = fields.sourceMapping ?? null;
    updateData.status = fields.sourceMapping ? 'mapped' : 'missing';
  }
  if ('allowedValues' in fields) updateData.allowedValues = fields.allowedValues ?? null;
  if ('description' in fields) updateData.description = fields.description ?? null;
  if (fields.status !== undefined) updateData.status = fields.status;

  const [field] = await db.update(destinationFieldsTable)
    .set(updateData)
    .where(and(eq(destinationFieldsTable.id, id), eq(destinationFieldsTable.projectId, projectId)))
    .returning();

  // Mark analysis outdated when confirmed requirements change
  const currentField = await db.select().from(destinationFieldsTable)
    .where(eq(destinationFieldsTable.id, id));
  if (currentField[0]?.isConfirmed) {
    await db.update(migrationProjectsTable)
      .set({ analysisOutdated: true, updatedAt: new Date() })
      .where(eq(migrationProjectsTable.id, projectId));
  }

  return field;
}

export async function deleteDestinationField(input: { id: number; projectId: number }): Promise<void> {
  await db.delete(destinationFieldsTable).where(
    and(eq(destinationFieldsTable.id, input.id), eq(destinationFieldsTable.projectId, input.projectId))
  );
  // Mark analysis outdated
  await db.update(migrationProjectsTable)
    .set({ analysisOutdated: true, updatedAt: new Date() })
    .where(eq(migrationProjectsTable.id, input.projectId));
}

export async function confirmRequirement(input: {
  id: number;
  projectId: number;
}): Promise<DestinationField> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const [field] = await db.update(destinationFieldsTable)
    .set({
      isConfirmed: true,
      confirmedById: user.id,
      confirmedAt: new Date(),
    })
    .where(and(eq(destinationFieldsTable.id, input.id), eq(destinationFieldsTable.projectId, input.projectId)))
    .returning();

  // Mark analysis outdated since requirements changed
  await db.update(migrationProjectsTable)
    .set({ analysisOutdated: true, updatedAt: new Date() })
    .where(eq(migrationProjectsTable.id, input.projectId));

  await db.insert(auditLogTable).values({
    projectId: input.projectId,
    action: 'requirement_confirmed',
    details: `Confirmed requirement: ${field.fieldName}`,
    performedById: user.id,
  });

  return field;
}

export async function bulkConfirmRequirements(input: {
  projectId: number;
  fieldIds: number[];
}): Promise<{ confirmed: number }> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const now = new Date();
  let confirmed = 0;

  for (const fieldId of input.fieldIds) {
    const result = await db.update(destinationFieldsTable)
      .set({ isConfirmed: true, confirmedById: user.id, confirmedAt: now })
      .where(and(
        eq(destinationFieldsTable.id, fieldId),
        eq(destinationFieldsTable.projectId, input.projectId),
      ))
      .returning();
    if (result.length > 0) confirmed++;
  }

  if (confirmed > 0) {
    await db.update(migrationProjectsTable)
      .set({
        analysisOutdated: true,
        requirementsConfirmedAt: now,
        requirementsConfirmedById: user.id,
        updatedAt: now,
      })
      .where(eq(migrationProjectsTable.id, input.projectId));

    await db.insert(auditLogTable).values({
      projectId: input.projectId,
      action: 'requirements_bulk_confirmed',
      details: `Confirmed ${confirmed} destination requirement(s)`,
      performedById: user.id,
    });
  }

  return { confirmed };
}

export async function suggestRequirementsFromTemplate(input: {
  projectId: number;
  headers: string[];
  sampleRows: Record<string, string>[];
}): Promise<{ suggested: number }> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  // Build per-column sample value analysis
  const columnStats = input.headers.slice(0, 30).map(header => {
    const values = input.sampleRows
      .map(row => String(row[header] ?? '').trim())
      .filter(v => v !== '');
    const distinct = [...new Set(values)];
    return { header, sampleCount: input.sampleRows.length, nonBlankCount: values.length, distinct };
  });

  const columnSummaries = columnStats.map(c =>
    `"${c.header}": ${c.nonBlankCount}/${c.sampleCount} rows non-blank, ${c.distinct.length} distinct value(s): [${c.distinct.slice(0, 8).map(v => JSON.stringify(v)).join(', ')}${c.distinct.length > 8 ? ', ...' : ''}]`
  ).join('\n');

  const prompt = `You are a data migration expert. Analyze columns from a destination template file.
For each column, produce a structured inference. Apply these rules strictly:

## Allowed Values Rules
- Only set allowedValues for fields that are CLEARLY categorical/picklist: status, tier, stage, type, priority, category, or similar control fields where every valid value is known and finite.
- Do NOT set allowedValues for open-ended fields such as: name, company, address, city, state, country, industry, description, notes, or any free-text field even if the sample contains only a few distinct values.
- Country fields: set fieldType="text", do NOT create an allowedValues list from sample countries. Instead note in description that ISO 3166-1 alpha-2 codes are recommended.
- Do not infer a field is categorical solely because it has few distinct values in a small sample.

## Required Field Rules
- Do NOT mark a field required simply because all sample rows happened to have a value.
- Only suggest required=true when the field name or business context strongly implies it is essential (e.g., "id", "email", "name", "account_id").
- In requiredEvidence, always explain your reasoning, e.g. "Field name 'id' implies a primary identifier" or "All 5 sample rows populated, but small sample; suggesting required based on field name only".

## Semantic Type Rules
- Fields containing "email" or "e-mail" → fieldType="email"
- Fields containing "date", "_at", "_on", "created", "updated", "dob", "birth", "expiry" → fieldType="date"
- Fields containing "amount", "price", "cost", "revenue", "fee", "balance" → fieldType="currency"
- Fields containing "id", "_id", "identifier", "code" (but not "zip_code", "postal_code") → fieldType="identifier"
- Fields containing "phone", "fax", "zip", "postal" → fieldType="text"
- Boolean fields: "active", "enabled", "is_", "has_", "flag" → fieldType="boolean"
- Otherwise default to "text"

## Unique Field Rules
- Only suggest isUnique=true for clear primary identifiers: fields named "id", "account_id", "customer_id", "email" (when it's clearly the primary login), or similar.

Column data:
${columnSummaries}

For each column output exactly:
{
  "fieldName": "original column name",
  "fieldType": "text|number|email|date|boolean|enum_type|currency|identifier",
  "required": true|false,
  "requiredEvidence": "one sentence explaining why required was set to this value",
  "isUnique": true|false,
  "allowedValues": ["val1","val2"] or null,
  "observedSampleValues": ["val1","val2"] up to 8 distinct non-blank values actually seen,
  "description": "plain-language description of what this field contains",
  "reasoning": "1-2 sentences explaining the type, required, and allowed-values decisions"
}

Respond ONLY with a valid JSON array.`;

  let suggestions: Array<{
    fieldName: string;
    fieldType: DestinationField['fieldType'];
    required: boolean;
    requiredEvidence: string;
    isUnique: boolean;
    allowedValues: string[] | null;
    observedSampleValues: string[] | null;
    description: string;
    reasoning: string;
  }> = [];

  try {
    const rawText = await ai.singleResponse({
      systemPrompt: 'You are a data migration expert. Respond only with valid JSON.',
      userPrompt: prompt,
    });
    const text = typeof rawText === 'string' ? rawText : String(rawText);
    const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
    if (Array.isArray(parsed)) {
      suggestions = parsed.slice(0, 30);
    }
  } catch (err) {
    captureError(err);
    // Fallback: create basic inferred fields using column stats
    suggestions = columnStats.map(c => ({
      fieldName: c.header,
      fieldType: 'text' as const,
      required: false,
      requiredEvidence: 'AI analysis unavailable; defaulting to not required.',
      isUnique: false,
      allowedValues: null,
      observedSampleValues: c.distinct.slice(0, 8),
      description: '',
      reasoning: 'AI analysis unavailable. Field created with basic defaults.',
    }));
  }

  // Get existing fields to determine sort order
  const existing = await db.select().from(destinationFieldsTable)
    .where(eq(destinationFieldsTable.projectId, input.projectId));
  const existingNames = new Set(existing.map(f => normalizeFieldName(f.fieldName)));

  let created = 0;
  for (const s of suggestions) {
    if (existingNames.has(normalizeFieldName(s.fieldName))) continue;
    const validTypes: DestinationField['fieldType'][] = ['text', 'number', 'email', 'date', 'boolean', 'enum_type', 'currency', 'identifier'];
    const fieldType: DestinationField['fieldType'] = validTypes.includes(s.fieldType) ? s.fieldType : 'text';

    // Build combined reasoning note including required evidence
    const fullReasoning = [s.reasoning, s.requiredEvidence].filter(Boolean).join(' | Required: ');

    await db.insert(destinationFieldsTable).values({
      projectId: input.projectId,
      fieldName: s.fieldName,
      fieldType,
      required: s.required ?? false,
      isUnique: s.isUnique ?? false,
      sourceMapping: null,
      allowedValues: s.allowedValues?.length ? s.allowedValues : null,
      observedSampleValues: s.observedSampleValues?.length ? s.observedSampleValues : null,
      description: s.description || null,
      suggestionReasoning: fullReasoning || null,
      status: 'missing',
      requirementSource: 'ai_suggested',
      isConfirmed: false,
      confirmedById: null,
      confirmedAt: null,
      sortOrder: existing.length + created,
    });
    created++;
  }

  await db.insert(auditLogTable).values({
    projectId: input.projectId,
    action: 'requirements_suggested',
    details: `AI suggested ${created} destination requirements from template file`,
    performedById: user.id,
  });

  return { suggested: created };
}

export async function getValidationRules(input: { projectId: number }): Promise<ValidationRule[]> {
  return db.select().from(validationRulesTable)
    .where(eq(validationRulesTable.projectId, input.projectId))
    .orderBy(validationRulesTable.createdAt);
}

export async function createValidationRule(input: {
  projectId: number;
  fieldId?: number;
  name: string;
  ruleType: ValidationRule['ruleType'];
  ruleConfig?: Record<string, unknown>;
}): Promise<ValidationRule> {
  const [rule] = await db.insert(validationRulesTable).values({
    projectId: input.projectId,
    fieldId: input.fieldId ?? null,
    name: input.name,
    ruleType: input.ruleType,
    ruleConfig: input.ruleConfig ?? null,
    enabled: true,
  }).returning();

  return rule;
}

export async function updateValidationRule(input: {
  id: number;
  projectId: number;
  enabled?: boolean;
  name?: string;
  ruleConfig?: Record<string, unknown>;
}): Promise<ValidationRule> {
  const { id, projectId, ...fields } = input;
  const [rule] = await db.update(validationRulesTable)
    .set(fields)
    .where(and(eq(validationRulesTable.id, id), eq(validationRulesTable.projectId, projectId)))
    .returning();
  return rule;
}

export async function deleteValidationRule(input: { id: number; projectId: number }): Promise<void> {
  await db.delete(validationRulesTable).where(
    and(eq(validationRulesTable.id, input.id), eq(validationRulesTable.projectId, input.projectId))
  );
}

export async function getDuplicateRequirements(input: { projectId: number }): Promise<{
  duplicates: Array<{ normalizedName: string; fields: DestinationField[] }>;
}> {
  const fields = await db.select().from(destinationFieldsTable)
    .where(eq(destinationFieldsTable.projectId, input.projectId));

  const groups = new Map<string, DestinationField[]>();
  for (const f of fields) {
    const norm = normalizeFieldName(f.fieldName);
    if (!groups.has(norm)) groups.set(norm, []);
    groups.get(norm)!.push(f);
  }

  const duplicates: Array<{ normalizedName: string; fields: DestinationField[] }> = [];
  for (const [norm, grp] of groups.entries()) {
    if (grp.length > 1) duplicates.push({ normalizedName: norm, fields: grp });
  }

  return { duplicates };
}

server.data('getDuplicateRequirements', getDuplicateRequirements);
server.data('getDestinationFields', getDestinationFields);
server.data('createDestinationField', createDestinationField);
server.data('updateDestinationField', updateDestinationField);
server.data('deleteDestinationField', deleteDestinationField);
server.data('confirmRequirement', confirmRequirement);
server.data('bulkConfirmRequirements', bulkConfirmRequirements);
server.data('suggestRequirementsFromTemplate', suggestRequirementsFromTemplate);
server.data('getValidationRules', getValidationRules);
server.data('createValidationRule', createValidationRule);
server.data('updateValidationRule', updateValidationRule);
server.data('deleteValidationRule', deleteValidationRule);

export async function autoMapFields(input: { projectId: number }): Promise<{ mapped: number }> {
  const fields = await db.select().from(destinationFieldsTable)
    .where(eq(destinationFieldsTable.projectId, input.projectId));

  // Get source files to extract columns
  const { sourceFilesTable } = await import('@/db/schema');
  const files = await db.select().from(sourceFilesTable)
    .where(eq(sourceFilesTable.projectId, input.projectId));

  const sourceColumns: string[] = [...new Set(files.flatMap(f => f.columns ?? []))];
  if (sourceColumns.length === 0) return { mapped: 0 };

  let mapped = 0;
  for (const field of fields) {
    if (field.sourceMapping) continue; // already mapped
    const normalizedField = normalizeFieldName(field.fieldName);
    // Exact match (case-insensitive)
    const exactMatch = sourceColumns.find(
      col => col.toLowerCase() === field.fieldName.toLowerCase()
    );
    // Normalized match
    const normalizedMatch = exactMatch ?? sourceColumns.find(
      col => normalizeFieldName(col) === normalizedField
    );
    if (normalizedMatch) {
      await db.update(destinationFieldsTable)
        .set({ sourceMapping: normalizedMatch, status: 'mapped' })
        .where(eq(destinationFieldsTable.id, field.id));
      mapped++;
    }
  }

  return { mapped };
}

server.data('autoMapFields', autoMapFields);