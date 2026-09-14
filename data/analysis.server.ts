import { server, db, currentUser, ai, captureError } from '@aha-app/builder-core';
import { eq, and, inArray, sql } from 'drizzle-orm';
import {
  migrationRecordsTable,
  destinationFieldsTable,
  validationRulesTable,
  migrationProjectsTable,
  auditLogTable,
  sourceFilesTable,
  referenceFilesTable,
  type MigrationRecord,
} from '@/db/schema';

// ---- Finding types ----

export interface RuleFinding {
  findingSource: 'destination_rule';
  field: string;
  rule: string;
  sourceValue: string | null;
  expectedValue: string | null;
  explanation: string;
  severity: 'error' | 'warning';
  status: 'open';
}

export interface AIFinding {
  findingSource: 'ai_analysis';
  field?: string;
  sourceValue?: string | null;
  explanation: string;
  evidence?: string;           // the specific source value or signal that triggered this finding
  whyItMatters?: string;       // why this matters for the migration decision
  recommendedAction?: string;  // specific question or action for a reviewer
  suggestedQuestion?: string;  // a specific question to ask a stakeholder
  confidence?: number;         // per-finding confidence 0-1
  issueType: string | null;
  severity: 'warning' | 'info';
  status: 'open';
}

// Legacy type kept for backward-compat reads
export interface ValidationError {
  field: string;
  rule: string;
  message: string;
  issueSource: 'rule';
}

export type RecommendedDisposition =
  | 'ready_for_approval'
  | 'consolidate'
  | 'discuss'
  | 'exclude'
  | 'needs_manual_review';

export interface DuplicateMatchField {
  field: string;
  value: string;
  matchType: 'exact' | 'near';
}

export interface DuplicateConflictField {
  field: string;
  sourceValue: string;
  matchValue: string;
}

export interface DuplicateMatch {
  recordId: number;
  rowNumber: number;
  confidence: number;
  matchingFields: DuplicateMatchField[];
  conflictingFields: DuplicateConflictField[];
  recordSummary: string;
  matchCategory: 'source_to_source' | 'source_to_destination';
  explanation: string;
  referenceData?: Record<string, unknown>; // populated for source_to_destination matches
}

// ---- Deterministic rule validation ----

function validateRecord(
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
      findings.push({
        findingSource: 'destination_rule',
        field: field.fieldName,
        rule: 'required',
        sourceValue: null,
        expectedValue: 'non-empty value',
        explanation: `${field.fieldName} is a confirmed required destination field but the source record has no value.`,
        severity: 'error',
        status: 'open',
      });
      continue;
    }
    if (isEmpty) continue;

    const strValue = String(value);

    if (field.fieldType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strValue)) {
      findings.push({
        findingSource: 'destination_rule',
        field: field.fieldName,
        rule: 'email_format',
        sourceValue: strValue,
        expectedValue: 'valid email address',
        explanation: `${field.fieldName} must be a valid email address.`,
        severity: 'error',
        status: 'open',
      });
    }
    if (field.fieldType === 'number' && isNaN(Number(value))) {
      findings.push({
        findingSource: 'destination_rule',
        field: field.fieldName,
        rule: 'data_type',
        sourceValue: strValue,
        expectedValue: 'number',
        explanation: `${field.fieldName} must be a number; received "${strValue}".`,
        severity: 'error',
        status: 'open',
      });
    }
    if (field.fieldType === 'date' && isNaN(Date.parse(strValue))) {
      findings.push({
        findingSource: 'destination_rule',
        field: field.fieldName,
        rule: 'data_type',
        sourceValue: strValue,
        expectedValue: 'valid date',
        explanation: `${field.fieldName} must be a valid date; received "${strValue}".`,
        severity: 'error',
        status: 'open',
      });
    }
    if (
      field.allowedValues &&
      field.allowedValues.length > 0 &&
      !field.allowedValues.includes(strValue)
    ) {
      findings.push({
        findingSource: 'destination_rule',
        field: field.fieldName,
        rule: 'allowed_values',
        sourceValue: strValue,
        expectedValue: field.allowedValues.join(' | '),
        explanation: `${field.fieldName} must be one of the confirmed allowed values: ${field.allowedValues.join(', ')}. Received "${strValue}".`,
        severity: 'error',
        status: 'open',
      });
    }
  }

  return findings;
}

// ---- Recommended disposition computation ----

function computeInitialDisposition(
  ruleFindings: RuleFinding[],
  aiFindings: AIFinding[],
  aiConfidence: number,
): RecommendedDisposition {
  const warningFindings = aiFindings.filter(f => f.severity === 'warning');
  const excludeTypes = new Set(['test_data', 'obsolete']);
  const discussTypes = new Set(['needs_clarification', 'conflict', 'ambiguous_data']);

  // Rule violations → needs manual review
  if (ruleFindings.length > 0) return 'needs_manual_review';

  // AI suggests test data / obsolete → recommend exclusion
  const excludeFindings = warningFindings.filter(f => f.issueType && excludeTypes.has(f.issueType));
  if (excludeFindings.length > 0) return 'exclude';

  // AI suggests needs clarification / conflict / ambiguous → discuss
  const discussFindings = warningFindings.filter(f => f.issueType && discussTypes.has(f.issueType));
  if (discussFindings.length > 0) return 'discuss';

  // Other AI warnings → needs manual review
  if (warningFindings.length > 0) return 'needs_manual_review';

  // All clear
  if (aiConfidence >= 0.7) return 'ready_for_approval';

  return 'needs_manual_review';
}

function buildDispositionReason(
  disposition: RecommendedDisposition,
  ruleFindings: RuleFinding[],
  aiFindings: AIFinding[],
  aiConfidence: number,
  confirmedFieldCount: number,
): string {
  switch (disposition) {
    case 'ready_for_approval':
      return `All ${confirmedFieldCount} confirmed destination requirements passed. No significant contextual issues detected by AI analysis (${Math.round(aiConfidence * 100)}% confidence). This record appears ready to migrate as-is.`;
    case 'needs_manual_review':
      if (ruleFindings.length > 0) {
        return `${ruleFindings.length} destination rule violation(s) found: ${ruleFindings.map(f => `${f.field} (${f.rule})`).join(', ')}. These must be resolved before approval.`;
      }
      return `AI analysis identified issues that require human judgment before this record can be approved (${Math.round(aiConfidence * 100)}% confidence).`;
    case 'exclude':
      const excludeFinding = aiFindings.find(f => f.issueType === 'test_data' || f.issueType === 'obsolete');
      return excludeFinding
        ? `AI identified this record as potentially non-production: ${excludeFinding.explanation} Review and confirm exclusion.`
        : 'Record appears intentionally non-production or obsolete. Requires human confirmation before exclusion.';
    case 'discuss':
      const discussFinding = aiFindings.find(f =>
        f.issueType === 'needs_clarification' || f.issueType === 'conflict' || f.issueType === 'ambiguous_data'
      );
      return discussFinding
        ? `Ambiguous or unclear data requires business context before a safe decision can be made: ${discussFinding.explanation}`
        : 'This record contains ambiguous data that requires stakeholder input before proceeding.';
    case 'consolidate':
      return 'A likely duplicate was detected. Review the matching evidence and decide whether to consolidate. For destination matches, the existing record will survive and this source record will be marked consolidated.';
  }
}

// ---- Duplicate detection ----

function normalizeEmail(val: unknown): string | null {
  if (typeof val !== 'string' || !val.trim()) return null;
  return val.trim().toLowerCase();
}

function normalizePhone(val: unknown): string | null {
  if (typeof val !== 'string' || !val.trim()) return null;
  const digits = val.replace(/\D/g, '');
  return digits.length >= 7 ? digits : null;
}

function normalizeName(val: unknown): string | null {
  if (typeof val !== 'string' || !val.trim()) return null;
  return val
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\b(inc|llc|corp|ltd|co|the|and|&)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isEmailField(key: string): boolean {
  return /email/i.test(key);
}
function isPhoneField(key: string): boolean {
  return /phone|mobile|cell|fax/i.test(key);
}
// Detect identifier/key fields — never treat as name/identity signals
function isIdField(key: string): boolean {
  const k = key.toLowerCase().replace(/[\s\-]/g, '_');
  return k === 'id' || /_(id|key|code|number|num|ref)$/.test(k);
}
function isNameField(key: string): boolean {
  if (isIdField(key)) return false; // customer_id, account_id, etc. are NOT name signals
  return /\bname\b|company|organization|account|customer/i.test(key);
}
function isDomainField(key: string): boolean {
  return /\bdomain\b|website|url/i.test(key);
}

// Fields that carry broad categorical values — never sufficient duplicate evidence on their own
const CATEGORICAL_RE = /\b(account_tier|tier|status|country|industry|category|type|segment|region|plan|rating|grade|level|stage|phase|class|division|vertical|market|sector|currency|language|source|channel|medium)\b/i;
function isCategoricalField(key: string): boolean {
  return CATEGORICAL_RE.test(key.replace(/[\s-]/g, '_'));
}

// Generic public email providers — domain matches on these carry no identity signal
const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'protonmail.com', 'mail.com', 'live.com', 'msn.com',
  'ymail.com', 'googlemail.com', 'me.com',
]);

function extractBusinessDomain(email: string): string | null {
  const m = email.match(/@([^@]+)$/);
  if (!m) return null;
  const domain = m[1].toLowerCase();
  return GENERIC_EMAIL_DOMAINS.has(domain) ? null : domain;
}

// Bigram similarity — used for company name fuzzy matching
function bigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) ?? 0) + 1);
    }
    return m;
  };
  const ba = bigrams(a);
  const bb = bigrams(b);
  let intersection = 0;
  for (const [bg, cnt] of ba) intersection += Math.min(cnt, bb.get(bg) ?? 0);
  const totalA = [...ba.values()].reduce((s, v) => s + v, 0);
  const totalB = [...bb.values()].reduce((s, v) => s + v, 0);
  return totalA + totalB === 0 ? 0 : (2 * intersection) / (totalA + totalB);
}

// Thresholds
const DUP_SHOW_THRESHOLD = 0.65;        // minimum confidence to surface as a candidate
const DUP_CONSOLIDATE_THRESHOLD = 0.85; // minimum confidence to recommend Consolidate

interface RecordIndex {
  id: number;
  rowNumber: number;
  emails: Record<string, string>;   // fieldKey → normalized
  phones: Record<string, string>;
  names: Record<string, string>;
  domains: Set<string>;             // non-generic business domains
  data: Record<string, unknown>;
}

function buildRecordIndex(record: MigrationRecord): RecordIndex {
  const data = record.data as Record<string, unknown>;
  const emails: Record<string, string> = {};
  const phones: Record<string, string> = {};
  const names: Record<string, string> = {};
  const domains = new Set<string>();

  for (const [key, val] of Object.entries(data)) {
    // Never index categorical fields — they carry no identity signal
    if (isCategoricalField(key)) continue;

    if (isEmailField(key)) {
      const norm = normalizeEmail(val);
      if (norm) {
        emails[key] = norm;
        const domain = extractBusinessDomain(norm);
        if (domain) domains.add(domain);
      }
    }
    if (isPhoneField(key)) {
      const norm = normalizePhone(val);
      if (norm) phones[key] = norm;
    }
    if (isNameField(key)) {
      const norm = normalizeName(val);
      if (norm) names[key] = norm;
    }
    if (isDomainField(key) && typeof val === 'string' && val.trim()) {
      const clean = val.trim().toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '');
      if (clean && !clean.includes('@') && !GENERIC_EMAIL_DOMAINS.has(clean)) {
        domains.add(clean);
      }
    }
  }

  return { id: record.id, rowNumber: record.rowNumber, emails, phones, names, domains, data };
}

function findDuplicates(
  target: RecordIndex,
  others: RecordIndex[],
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];

  for (const other of others) {
    if (other.id === target.id) continue;

    const matchingFields: DuplicateMatchField[] = [];
    const evidenceSignals: string[] = [];

    // ---- Email exact match ----
    let emailMatch = false;
    for (const [field, norm] of Object.entries(target.emails)) {
      const otherNorm = other.emails[field] ?? Object.values(other.emails).find(v => v === norm);
      if (otherNorm === norm) {
        emailMatch = true;
        matchingFields.push({ field, value: norm, matchType: 'exact' });
        evidenceSignals.push(`exact email (${field})`);
        break;
      }
    }

    // ---- Phone exact match ----
    let phoneMatch = false;
    for (const [field, norm] of Object.entries(target.phones)) {
      const otherNorm = other.phones[field] ?? Object.values(other.phones).find(v => v === norm);
      if (otherNorm === norm) {
        phoneMatch = true;
        matchingFields.push({ field, value: norm, matchType: 'exact' });
        evidenceSignals.push(`exact phone (${field})`);
        break;
      }
    }

    // ---- Company name similarity ----
    let bestNameSim = 0;
    let bestNameField = '';
    let bestNameValue = '';
    for (const [field, norm] of Object.entries(target.names)) {
      for (const oNorm of Object.values(other.names)) {
        const sim = bigramSimilarity(norm, oNorm);
        if (sim > bestNameSim) { bestNameSim = sim; bestNameField = field; bestNameValue = norm; }
      }
    }
    const highName = bestNameSim >= 0.80;
    const strongName = bestNameSim >= 0.92;

    if (highName && bestNameField) {
      const mt = strongName ? 'exact' : 'near';
      matchingFields.push({ field: bestNameField, value: bestNameValue, matchType: mt });
      evidenceSignals.push(`${strongName ? 'highly similar' : 'similar'} company name (${Math.round(bestNameSim * 100)}% match)`);
    }

    // ---- Business domain match ----
    let domainMatch = false;
    let matchedDomain = '';
    for (const domain of target.domains) {
      if (other.domains.has(domain)) {
        domainMatch = true;
        matchedDomain = domain;
        matchingFields.push({ field: 'domain', value: domain, matchType: 'exact' });
        evidenceSignals.push(`matching business domain (${domain})`);
        break;
      }
    }

    // ---- Confidence scoring ----
    // Rules:
    //   • Email alone → strong (0.88)
    //   • Phone alone → moderate (0.76)
    //   • Name alone (very high) → weak (0.60) — below show threshold unless combined
    //   • Email + name → very strong (0.95)
    //   • Phone + name → strong (0.90)
    //   • Name + domain → strong (0.82)
    //   • Email + domain → strong (0.92)
    //   • Categorical fields — never contribute
    let confidence = 0;

    if (emailMatch) {
      confidence = 0.88;
      if (highName)  confidence = Math.min(0.97, confidence + 0.07);
      if (domainMatch) confidence = Math.min(0.97, confidence + 0.04);
    } else if (phoneMatch) {
      confidence = 0.76;
      if (highName)  confidence = Math.min(0.93, confidence + 0.14);
      if (domainMatch) confidence = Math.min(0.91, confidence + 0.06);
    } else if (highName && domainMatch) {
      confidence = strongName ? 0.84 : 0.79;
    } else if (strongName) {
      // Name alone at very high similarity — show but don’t consolidate without more evidence
      confidence = 0.62;
    } else {
      // No meaningful identity signals — skip entirely
      continue;
    }

    if (confidence < DUP_SHOW_THRESHOLD) continue;

    // ---- Conflicting fields (identity fields only, not categorical) ----
    const conflictingFields: DuplicateConflictField[] = [];
    const matchedKeys = new Set(matchingFields.map(f => f.field));
    for (const [field, val] of Object.entries(target.data)) {
      if (isCategoricalField(field)) continue;
      const otherVal = other.data[field];
      if (
        otherVal !== undefined &&
        String(val) !== String(otherVal) &&
        val !== '' && otherVal !== '' &&
        (isNameField(field) || isEmailField(field) || isPhoneField(field)) &&
        !matchedKeys.has(field)
      ) {
        conflictingFields.push({ field, sourceValue: String(val), matchValue: String(otherVal) });
      }
    }

    // ---- Build explanation ----
    const strengthLabel = confidence >= DUP_CONSOLIDATE_THRESHOLD
      ? 'Strong match — consolidation recommended.'
      : 'Moderate match — manual review recommended before consolidating.';
    const explanation = `Possible duplicate based on: ${evidenceSignals.join('; ')}. ${strengthLabel}`;

    const recordSummary = Object.entries(other.data)
      .filter(([k]) => !isCategoricalField(k))
      .slice(0, 3)
      .map(([, v]) => String(v))
      .filter(Boolean)
      .join(' · ');

    matches.push({
      recordId: other.id,
      rowNumber: other.rowNumber,
      confidence,
      matchingFields,
      conflictingFields: conflictingFields.slice(0, 4),
      recordSummary,
      matchCategory: 'source_to_source',
      explanation,
    });
  }

  return matches.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}

function buildRefRecordIndex(row: Record<string, unknown>, syntheticId: number, rowNum: number): RecordIndex {
  // Re-use same logic as buildRecordIndex but with synthetic IDs
  const emails: Record<string, string> = {};
  const phones: Record<string, string> = {};
  const names: Record<string, string> = {};
  const domains = new Set<string>();

  for (const [key, val] of Object.entries(row)) {
    if (isCategoricalField(key)) continue;
    if (isEmailField(key)) {
      const norm = normalizeEmail(val);
      if (norm) { emails[key] = norm; const d = extractBusinessDomain(norm); if (d) domains.add(d); }
    }
    if (isPhoneField(key)) { const norm = normalizePhone(val); if (norm) phones[key] = norm; }
    if (isNameField(key)) { const norm = normalizeName(val); if (norm) names[key] = norm; }
    if (isDomainField(key) && typeof val === 'string' && val.trim()) {
      const clean = val.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
      if (clean && !clean.includes('@') && !GENERIC_EMAIL_DOMAINS.has(clean)) domains.add(clean);
    }
  }
  return { id: syntheticId, rowNumber: rowNum, emails, phones, names, domains, data: row };
}

// ---- Requirements status ----

export async function getRequirementsStatus(input: { projectId: number }): Promise<{
  totalRequirements: number;
  confirmedCount: number;
  unconfirmedCount: number;
  aiSuggestedUnconfirmed: number;
  hasConfirmedRequirements: boolean;
  analysisOutdated: boolean;
  duplicateFieldNames: string[];
}> {
  const [fields, project] = await Promise.all([
    db.select().from(destinationFieldsTable).where(eq(destinationFieldsTable.projectId, input.projectId)),
    db.select().from(migrationProjectsTable).where(eq(migrationProjectsTable.id, input.projectId)),
  ]);

  const confirmed = fields.filter(f => f.isConfirmed);
  const unconfirmed = fields.filter(f => !f.isConfirmed);
  const aiUnconfirmed = unconfirmed.filter(f => f.requirementSource === 'ai_suggested');

  const normalizedNames = confirmed.map(f => f.fieldName.toLowerCase().replace(/[\s_-]/g, ''));
  const seen = new Set<string>();
  const dupeNames = new Set<string>();
  for (const norm of normalizedNames) {
    if (seen.has(norm)) dupeNames.add(norm);
    seen.add(norm);
  }
  const duplicateFieldNames = confirmed
    .filter(f => dupeNames.has(f.fieldName.toLowerCase().replace(/[\s_-]/g, '')))
    .map(f => f.fieldName);

  return {
    totalRequirements: fields.length,
    confirmedCount: confirmed.length,
    unconfirmedCount: unconfirmed.length,
    aiSuggestedUnconfirmed: aiUnconfirmed.length,
    hasConfirmedRequirements: confirmed.length > 0,
    analysisOutdated: project[0]?.analysisOutdated ?? false,
    duplicateFieldNames,
  };
}

// ---- Main analysis function ----

export async function analyzeRecords(input: { projectId: number; recordIds?: number[] }): Promise<{
  analyzed: number;
  totalImported: number;
  failed: number;
  failedReasons: string[];
  issues: number;
  requirementsWarning?: string;
  duplicateWarning?: string;
}> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  // 1. Load confirmed requirements
  const allFields = await db.select().from(destinationFieldsTable)
    .where(eq(destinationFieldsTable.projectId, input.projectId));

  const confirmedFields = allFields.filter(f => f.isConfirmed);
  const unconfirmedCount = allFields.filter(f => !f.isConfirmed).length;

  const normalizedNames = confirmedFields.map(f => f.fieldName.toLowerCase().replace(/[\s_-]/g, ''));
  const seen = new Set<string>();
  const dupeNormNames = new Set<string>();
  for (const norm of normalizedNames) {
    if (seen.has(norm)) dupeNormNames.add(norm);
    seen.add(norm);
  }
  const duplicateFieldNames = confirmedFields
    .filter(f => dupeNormNames.has(f.fieldName.toLowerCase().replace(/[\s_-]/g, '')))
    .map(f => f.fieldName);

  // 2. Load records to analyze
  let records: MigrationRecord[];
  if (input.recordIds && input.recordIds.length > 0) {
    records = await db.select().from(migrationRecordsTable).where(
      and(
        eq(migrationRecordsTable.projectId, input.projectId),
        inArray(migrationRecordsTable.id, input.recordIds)
      )
    );
  } else {
    records = await db.select().from(migrationRecordsTable)
      .where(eq(migrationRecordsTable.projectId, input.projectId));
  }

  // 3. Get total imported count
  const totalImportedResult = await db.select({ count: sql`count(*)::int` })
    .from(migrationRecordsTable)
    .where(eq(migrationRecordsTable.projectId, input.projectId));
  const totalImported = Number(totalImportedResult[0]?.count ?? 0);

  const snapshotDescription = `${confirmedFields.length} confirmed fields: ${confirmedFields.map(f => f.fieldName).join(', ')}`;

  // 4. Deterministic validation only (AI analysis runs on-demand per-record via analyzeRecordAI).
  // Removing AI from bulk analysis is the only reliable way to stay within the 40s server timeout —
  // each AI call takes 10-20s and cannot be bounded with setTimeout (not available in server runtime).
  let issueCount = 0;

  interface AnalysisResult {
    recordId: number;
    rowNumber: number;
    ruleFindings: RuleFinding[];
    aiConfidence: number;
    aiReasoning: string;
    aiIssueType: string | null;
    aiIssueSummary: string | null;
    initialDisposition: RecommendedDisposition;
  }

  const analysisResults: AnalysisResult[] = records.map(record => {
    const ruleFindings = validateRecord(record.data as Record<string, unknown>, confirmedFields);

    let aiConfidence: number;
    let aiReasoning: string;
    let aiIssueType: string | null = null;
    let aiIssueSummary: string | null = null;

    if (ruleFindings.length > 0) {
      aiConfidence = 0.3;
      aiIssueType = 'missing_info';
      aiIssueSummary = `${ruleFindings.length} destination rule violation(s): ${ruleFindings.map(f => f.field).join(', ')}`;
      aiReasoning = `Deterministic validation found ${ruleFindings.length} rule violation(s): ${ruleFindings.map(f => `${f.field} (${f.rule})`).join(', ')}. These must be resolved before approval.`;
    } else {
      aiConfidence = 0.85;
      aiReasoning = confirmedFields.length > 0
        ? `Validated against ${confirmedFields.length} confirmed destination requirements — no violations found. Use “Analyze with AI” in the review panel for contextual insights.`
        : 'No confirmed requirements to validate against. Use “Analyze with AI” in the review panel for contextual insights.';
    }

    if (ruleFindings.length > 0) issueCount++;

    const initialDisposition = computeInitialDisposition(ruleFindings, [], aiConfidence);

    return { recordId: record.id, rowNumber: record.rowNumber, ruleFindings, aiConfidence, aiReasoning, aiIssueType, aiIssueSummary, initialDisposition };
  });

  // 5. Phase 2: Duplicate detection
  // Build indexes for all records in this project (not just analyzed ones)
  const allProjectRecords = input.recordIds && input.recordIds.length > 0
    ? await db.select().from(migrationRecordsTable).where(eq(migrationRecordsTable.projectId, input.projectId))
    : records;

  const recordIndexes = allProjectRecords.map(buildRecordIndex);

  // Load reference data for cross-system duplicate detection
  const refFiles = await db.select().from(referenceFilesTable)
    .where(eq(referenceFilesTable.projectId, input.projectId));
  const refIndexes: RecordIndex[] = [];
  for (const rf of refFiles) {
    const rows = (rf.data as Record<string, unknown>[] | null) ?? [];
    rows.forEach((row, i) => {
      // Use large negative IDs to distinguish reference records from source records
      refIndexes.push(buildRefRecordIndex(row, -(rf.id * 10000 + i + 1), i + 1));
    });
  }

  // Map recordId → index for lookup
  const indexById = new Map(recordIndexes.map(idx => [idx.id, idx]));

  // Detect duplicates for analyzed records
  const duplicateResultMap = new Map<number, { matches: DuplicateMatch[]; confidence: number; recommendConsolidate: boolean }>();

  for (const result of analysisResults) {
    const targetIndex = indexById.get(result.recordId);
    if (!targetIndex) continue;

    // Source-to-source
    const srcMatches = findDuplicates(targetIndex, recordIndexes);
    // Source-to-destination (reference records) — attach raw reference data for consolidation modal
    const destMatches = refIndexes.length > 0
      ? findDuplicates(targetIndex, refIndexes).map(m => {
          const refIdx = refIndexes.find(r => r.id === m.recordId);
          return {
            ...m,
            matchCategory: 'source_to_destination' as const,
            referenceData: refIdx?.data as Record<string, unknown> | undefined,
          };
        })
      : [];

    const allMatches = [...srcMatches, ...destMatches];
    const significantMatches = allMatches.filter(m => m.confidence >= DUP_SHOW_THRESHOLD)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);

    if (significantMatches.length > 0) {
      duplicateResultMap.set(result.recordId, {
        matches: significantMatches,
        confidence: significantMatches[0].confidence,
        recommendConsolidate: significantMatches[0].confidence >= DUP_CONSOLIDATE_THRESHOLD,
      });
    }
  }

  // 6. Persist all results in sequential batches to avoid overwhelming DB connections
  const DB_WRITE_CONCURRENCY = 10;
  const legacyValidationErrorsType: ValidationError[] = [];

  for (let i = 0; i < analysisResults.length; i += DB_WRITE_CONCURRENCY) {
    const batch = analysisResults.slice(i, i + DB_WRITE_CONCURRENCY);
    await Promise.all(
      batch.map(async (result) => {
      const dupResult = duplicateResultMap.get(result.recordId);

      // Duplicate overrides disposition — only recommend consolidate for strong matches
      const finalDisposition: RecommendedDisposition = dupResult
        ? (dupResult.recommendConsolidate ? 'consolidate' : 'needs_manual_review')
        : result.initialDisposition;

      const dispositionReason = buildDispositionReason(
        finalDisposition,
        result.ruleFindings,
        [],
        result.aiConfidence,
        confirmedFields.length,
      );

      const legacyErrors: ValidationError[] = result.ruleFindings.map(f => ({
        field: f.field,
        rule: f.rule,
        message: f.explanation,
        issueSource: 'rule' as const,
      }));

      await db.update(migrationRecordsTable)
        .set({
          aiConfidence: result.aiConfidence,
          aiReasoning: result.aiReasoning,
          aiIssueType: result.aiIssueType,
          aiIssueSummary: result.aiIssueSummary,
          validationErrors: legacyErrors.length > 0 ? legacyErrors : null,
          destinationRuleFindings: result.ruleFindings.length > 0 ? result.ruleFindings : null,
          aiAnalysisFindings: null,
          recommendedDisposition: finalDisposition,
          recommendedDispositionReason: dispositionReason,
          duplicateRecordIds: dupResult ? dupResult.matches.map(m => m.recordId) : null,
          duplicateConfidence: dupResult ? dupResult.confidence : null,
          duplicateEvidence: dupResult ? dupResult.matches : null,
          suggestedQuestion: null,
        })
        .where(eq(migrationRecordsTable.id, result.recordId));
      })
    );
  }

  await db.update(migrationProjectsTable)
    .set({ status: 'reviewing', analysisOutdated: false, updatedAt: new Date() })
    .where(eq(migrationProjectsTable.id, input.projectId));

  const duplicatesFound = duplicateResultMap.size;

  await db.insert(auditLogTable).values({
    projectId: input.projectId,
    action: 'analysis_run',
    details: JSON.stringify({
      summary: `Analyzed ${records.length} of ${totalImported} imported records against ${confirmedFields.length} confirmed requirements. Found ${issueCount} record(s) with issues. ${duplicatesFound} likely duplicate(s) detected.`,
      requirementsSnapshot: snapshotDescription,
      analyzedCount: records.length,
      totalImported,
      issueCount,
      duplicatesFound,
      snapshotAt: new Date().toISOString(),
    }),
    performedById: user.id,
  });

  const requirementsWarning = unconfirmedCount > 0
    ? `Analysis used ${confirmedFields.length} confirmed requirements. ${unconfirmedCount} unconfirmed requirement(s) were excluded — confirm them in Destination Requirements.`
    : undefined;

  const duplicateWarning = duplicateFieldNames.length > 0
    ? `Warning: ${duplicateFieldNames.length} confirmed requirement(s) share a normalized name with another confirmed requirement (${duplicateFieldNames.join(', ')}). Review and remove duplicates to prevent ambiguous validation.`
    : undefined;

  return {
    analyzed: records.length,
    totalImported,
    failed: 0,
    failedReasons: [],
    issues: issueCount,
    requirementsWarning,
    duplicateWarning,
  };
}

// ---- Per-record on-demand AI analysis ----
// Separate from analyzeRecords to avoid server function timeout.
// Each AI call can take 10-20s; bulk analysis cannot safely batch them within 40s.

export async function analyzeRecordAI(input: { recordId: number; projectId: number }): Promise<{
  aiConfidence: number;
  aiReasoning: string;
  aiIssueType: string | null;
  aiIssueSummary: string | null;
  aiFindings: AIFinding[];
  recommendedDisposition: RecommendedDisposition;
  recommendedDispositionReason: string;
  suggestedQuestion: string | null;
}> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const [records, allFields] = await Promise.all([
    db.select().from(migrationRecordsTable).where(
      and(eq(migrationRecordsTable.id, input.recordId), eq(migrationRecordsTable.projectId, input.projectId))
    ),
    db.select().from(destinationFieldsTable).where(eq(destinationFieldsTable.projectId, input.projectId)),
  ]);

  const record = records[0];
  if (!record) throw new Error('Record not found');

  const confirmedFields = allFields.filter(f => f.isConfirmed);
  const ruleFindings = (record.destinationRuleFindings as RuleFinding[] | null) ?? [];

  const fieldSummary = confirmedFields.slice(0, 12).map(f =>
    `${f.fieldName} (${f.fieldType}${f.required ? ', REQUIRED' : ''}${f.allowedValues?.length ? `, allowed: [${f.allowedValues.join('/')}]` : ''})`
  ).join('; ');

  const data = record.data as Record<string, unknown>;
  let aiFindings: AIFinding[] = [];
  let aiConfidence = 0.85;
  let aiReasoning = confirmedFields.length > 0
    ? `Record evaluated against ${confirmedFields.length} confirmed destination requirements.`
    : 'Record appears complete and ready for migration.';
  let aiIssueType: string | null = null;
  let aiIssueSummary: string | null = null;
  let suggestedQuestion: string | null = null;

  // Load source-only column policies from project
  const projects = await db.select().from(migrationProjectsTable)
    .where(eq(migrationProjectsTable.id, input.projectId));
  const project = projects[0];
  const sourceColumnPolicies = (project?.sourceColumnPolicies ?? {}) as Record<string, string>;

  // Identify destination-mapped field names (case-insensitive)
  const destinationMappedKeys = new Set<string>(
    confirmedFields.flatMap(f => {
      const keys: string[] = [];
      if (f.sourceMapping) keys.push(f.sourceMapping.toLowerCase());
      keys.push(f.fieldName.toLowerCase().replace(/[\s_-]/g, ''));
      return keys;
    })
  );

  // Build comprehensive source-only fields context:
  // 1. Fields explicitly marked "review" by policy (highest priority)
  // 2. All other unmapped populated fields (including notes/text fields that may contain relevant context)
  const reviewPolicyFields: Array<{ key: string; value: unknown; priority: 'review_policy' | 'unmapped' }> = [];
  const notesLikeFields: Array<{ key: string; value: unknown }> = [];

  for (const [key, val] of Object.entries(data)) {
    if (val === null || val === undefined || val === '') continue;
    const isDestMapped = destinationMappedKeys.has(key.toLowerCase()) ||
      destinationMappedKeys.has(key.toLowerCase().replace(/[\s_-]/g, ''));
    if (isDestMapped) continue;

    const policy = sourceColumnPolicies[key];
    const keyLower = key.toLowerCase();
    const isNoteField = /note|comment|remark|description|memo|annotation|detail|message|text|narrative|summary/i.test(key);

    if (policy === 'review') {
      reviewPolicyFields.push({ key, value: val, priority: 'review_policy' });
    } else if (isNoteField) {
      // Notes/text fields always shown — they often contain critical migration context
      notesLikeFields.push({ key, value: val });
    } else if (policy !== 'ignore') {
      // Other unmapped populated fields (not explicitly ignored)
      reviewPolicyFields.push({ key, value: val, priority: 'unmapped' });
    }
  }

  // Limit unmapped non-note fields to avoid overwhelming the prompt; always include review_policy and notes
  const reviewOnlyFields = reviewPolicyFields.filter(f => f.priority === 'review_policy');
  const otherUnmappedFields = reviewPolicyFields.filter(f => f.priority === 'unmapped').slice(0, 8);
  const allContextFields = [...reviewOnlyFields, ...notesLikeFields.map(f => ({ ...f, priority: 'notes' as const })), ...otherUnmappedFields];

  // Build context sections
  let reviewFieldsContext = '';
  if (reviewOnlyFields.length > 0) {
    reviewFieldsContext += `\n\nSOURCE-ONLY FIELDS FLAGGED FOR REVIEW (highest priority — examine carefully):\n${reviewOnlyFields.map(f => `  ${f.key}: ${JSON.stringify(f.value)}`).join('\n')}\nThese fields have been explicitly marked as needing review. Look for undocumented codes, legacy markers, ambiguous values, historical data, or unclear business meaning.`;
  }
  if (notesLikeFields.length > 0) {
    reviewFieldsContext += `\n\nNOTES AND TEXT FIELDS (always relevant — check for explicit migration guidance):\n${notesLikeFields.map(f => `  ${f.key}: ${JSON.stringify(f.value)}`).join('\n')}\nNotes may contain explicit statements about record status, data quality, business context, or migration instructions.`;
  }
  if (otherUnmappedFields.length > 0) {
    reviewFieldsContext += `\n\nOTHER UNMAPPED SOURCE FIELDS (included for context):\n${otherUnmappedFields.map(f => `  ${f.key}: ${JSON.stringify(f.value)}`).join('\n')}`;
  }

  // Build a compact destination-mapped data summary (only mapped fields, max 15)
  const mappedDataEntries = Object.entries(data)
    .filter(([key]) => {
      return destinationMappedKeys.has(key.toLowerCase()) ||
        destinationMappedKeys.has(key.toLowerCase().replace(/[\s_-]/g, ''));
    });
  const mappedDataSummary = mappedDataEntries.slice(0, 15).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');

  try {
    const prompt = `You are a conservative data migration analyst. Your job is to protect both sides: prevent broken data from migrating AND prevent unnecessary human work.

Confirmed destination requirements: ${fieldSummary || 'None defined yet'}
${
  ruleFindings.length > 0
    ? `\nNote: Deterministic validation already found ${ruleFindings.length} rule violation(s): ${ruleFindings.map(f => f.field).join(', ')}. Focus ONLY on contextual issues beyond these.`
    : '\nDeterministic validation found no destination rule violations for this record.'
}
${reviewFieldsContext}

Destination-mapped source fields: ${mappedDataSummary || '(none)'}

## CORE PRINCIPLE

Only create human work when concrete source evidence justifies it.

## FORBIDDEN — Do NOT flag these (they apply to almost every record):
- A customer ID could theoretically conflict with destination records
- An email or contact might theoretically be outdated
- Additional information might exist elsewhere in the source system
- AI cannot independently verify ordinary business facts
- Any concern based on what you cannot verify, rather than what you can see
- A field is present in source but not mapped to destination (normal — not an issue)

## ALLOWED — Only flag when SOURCE DATA provides direct concrete evidence:

### → Recommend Exclusion (issueType: "test_data" or "obsolete") when:
- Record name, company, or ID contains obvious test/placeholder indicators: "Test Account", "John Doe", "test@test.com", "QA_", "TEMP_", ID=9999
- A note or text field EXPLICITLY says this is a test, internal, QA, sandbox, or non-production record
- A note or text field states the business has dissolved/closed/been acquired AND the record has no open balance, legal hold, or active obligation
- A field contains "DO NOT MIGRATE", "DELETED", or equivalent explicit instruction

### → Needs Clarification (issueType: "needs_clarification") when:
- A source-only field contains a code, abbreviation, or value AND a note EXPLICITLY says its meaning is undocumented or unknown
- A source field contains "LH", "HOLD", "legal_hold", or similar compliance marker AND a note says its current meaning is unclear or historical
- A source field contains a legacy code format AND the record notes explicitly state the code is legacy/deprecated/undocumented with no known current meaning
- A note or field EXPLICITLY says "confirm with stakeholder", "verify before migration", "unknown", "clarify", etc.

### → Conflict (issueType: "conflict") when:
- Two fields in the same record directly contradict each other with specific values (e.g., country="US" but phone="+44 ...", or date_joined > date_last_active)

## EVIDENCE REQUIREMENTS
For every finding you report:
- Quote the EXACT field name and value from the source data
- The finding MUST NOT exist without that specific evidence
- If you are unsure whether a finding is justified, do NOT include it

For each finding, provide:
- issueType: "test_data" | "obsolete" | "needs_clarification" | "conflict" | "ambiguous_data"
- field: exact field name
- sourceValue: the exact value that triggered this (verbatim)
- explanation: concise 1-sentence description of the specific issue
- evidence: quote the exact field:value pair(s) that justify this finding
- whyItMatters: one sentence — what goes wrong if this is ignored in the migration
- recommendedAction: a specific, actionable question or next step for the reviewer
- suggestedQuestion: if stakeholder input is needed, the exact question to ask (otherwise null)
- confidence: 0.0-1.0 — how certain you are this finding is real (not theoretical)
- severity: "warning" for issues that block/require action, "info" for low-risk context

If no concrete evidence of the above exists, return findings: []. Do NOT invent findings.

Respond with JSON only:
{
  "confidence": number,  // overall migration readiness 0-1 (>=0.85 when no warning findings)
  "reasoning": string,   // "No contextual issues found." if findings is empty; otherwise 1-2 sentences
  "suggestedQuestion": string | null,  // most important stakeholder question, or null
  "findings": [
    { "issueType": ..., "field": ..., "sourceValue": ..., "explanation": ..., "evidence": ..., "whyItMatters": ..., "recommendedAction": ..., "suggestedQuestion": ..., "confidence": ..., "severity": ... }
  ]
}`;

    const text = await ai.singleResponse({
      systemPrompt: 'You are a data migration analyst. Respond only with valid JSON.',
      userPrompt: prompt,
    });

    const rawText = typeof text === 'string' ? text : String(text);
    const parsed = JSON.parse(rawText.replace(/```json\n?|\n?```/g, '').trim());
    aiConfidence = Math.min(1, Math.max(0, parsed.confidence ?? 0.85));
    aiReasoning = parsed.reasoning ?? aiReasoning;
    suggestedQuestion = typeof parsed.suggestedQuestion === 'string' ? parsed.suggestedQuestion : null;

    if (Array.isArray(parsed.findings)) {
      aiFindings = (parsed.findings as Array<{
        issueType: string;
        field?: string;
        sourceValue?: string;
        explanation: string;
        evidence?: string;
        whyItMatters?: string;
        recommendedAction?: string;
        suggestedQuestion?: string;
        confidence?: number;
        severity?: string;
      }>).map(f => ({
        findingSource: 'ai_analysis' as const,
        field: f.field ?? undefined,
        sourceValue: f.sourceValue ?? null,
        explanation: f.explanation,
        evidence: f.evidence ?? undefined,
        whyItMatters: f.whyItMatters ?? undefined,
        recommendedAction: f.recommendedAction ?? undefined,
        suggestedQuestion: typeof f.suggestedQuestion === 'string' ? f.suggestedQuestion : undefined,
        confidence: typeof f.confidence === 'number' ? Math.min(1, Math.max(0, f.confidence)) : undefined,
        issueType: f.issueType ?? null,
        severity: (f.severity === 'info' ? 'info' : 'warning') as 'warning' | 'info',
        status: 'open' as const,
      }));
    }

    if (aiFindings.length > 0) {
      const topFinding = aiFindings.find(f => f.severity === 'warning') ?? aiFindings[0];
      aiIssueType = topFinding.issueType;
      aiIssueSummary = topFinding.explanation;
    }
  } catch (err) {
    captureError(err);
    aiReasoning = 'AI analysis unavailable. Deterministic validation results stand.';
  }

  // If AI found nothing actionable and prior disposition was ready_for_approval, keep it
  const priorDisposition = record.recommendedDisposition as RecommendedDisposition | null;
  const aiFoundIssues = aiFindings.some(f => f.severity === 'warning');
  let finalDisposition: RecommendedDisposition;
  if (!aiFoundIssues && priorDisposition === 'ready_for_approval' && ruleFindings.length === 0) {
    finalDisposition = 'ready_for_approval';
    if (!aiReasoning || aiReasoning === 'No contextual issues found') {
      aiReasoning = `No contextual issues found. All ${confirmedFields.length} confirmed destination requirements passed and AI analysis found no evidence-based concerns.`;
    }
  } else {
    finalDisposition = computeInitialDisposition(ruleFindings, aiFindings, aiConfidence);
  }
  const dispositionReason = buildDispositionReason(finalDisposition, ruleFindings, aiFindings, aiConfidence, confirmedFields.length);

  // Persist AI results back to the record
  await db.update(migrationRecordsTable)
    .set({
      aiConfidence,
      aiReasoning,
      aiIssueType,
      aiIssueSummary,
      aiAnalysisFindings: aiFindings.length > 0 ? aiFindings : null,
      recommendedDisposition: finalDisposition,
      recommendedDispositionReason: dispositionReason,
      suggestedQuestion,
    })
    .where(eq(migrationRecordsTable.id, input.recordId));

  return { aiConfidence, aiReasoning, aiIssueType, aiIssueSummary, aiFindings, recommendedDisposition: finalDisposition, recommendedDispositionReason: dispositionReason, suggestedQuestion };
}

server.data('getRequirementsStatus', getRequirementsStatus);
server.data('analyzeRecords', analyzeRecords);
server.data('analyzeRecordAI', analyzeRecordAI);