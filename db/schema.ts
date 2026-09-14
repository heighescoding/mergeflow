import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  boolean,
  real,
  jsonb,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const usersTable = pgTable('users', {
  id: serial('id').primaryKey(),
  authIdentifier: text('auth_identifier').notNull().unique(),
  email: text('email').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  avatarUrl: text('avatar_url'),
  roles: text('roles').array().notNull().default(['user']),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
export type NewUser = typeof usersTable.$inferInsert;

// ---- Enums ----

export const projectStatusEnum = pgEnum('project_status', [
  'setup',
  'analyzing',
  'reviewing',
  'complete',
  'finalized',
]);

export const sourceFileStatusEnum = pgEnum('source_file_status', [
  'processing',
  'complete',
  'error',
]);

export const fieldTypeEnum = pgEnum('field_type', [
  'text',
  'number',
  'email',
  'date',
  'boolean',
  'enum_type',
  'currency',
  'identifier',
]);

export const fieldStatusEnum = pgEnum('field_status', [
  'mapped',
  'missing',
  'review_needed',
  'confirmed',
]);

export const requirementSourceEnum = pgEnum('requirement_source', [
  'manual',
  'ai_suggested',
]);

export const recordStatusEnum = pgEnum('record_status', [
  'pending',
  'approved',
  'excluded',
  'discussing',
  'consolidated',
]);

export const ruleTypeEnum = pgEnum('rule_type', [
  'required',
  'unique',
  'email_format',
  'allowed_values',
  'data_type',
  'regex',
  'min_length',
  'max_length',
]);

// ---- Tables ----

export const migrationProjectsTable = pgTable('migration_projects', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  sourceOrg: text('source_org').notNull(),
  destinationOrg: text('destination_org').notNull(),
  description: text('description'),
  stakeholders: text('stakeholders'),
  status: projectStatusEnum('status').notNull().default('setup'),
  createdById: integer('created_by_id').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  analysisOutdated: boolean('analysis_outdated').notNull().default(false),
  requirementsConfirmedAt: timestamp('requirements_confirmed_at'),
  requirementsConfirmedById: integer('requirements_confirmed_by_id'),
  setupStep: integer('setup_step').notNull().default(6),
  setupComplete: boolean('setup_complete').notNull().default(true),
  referenceDataSkipped: boolean('reference_data_skipped').notNull().default(false),
  sourceColumnPolicies: jsonb('source_column_policies'),
  finalizedAt: timestamp('finalized_at'),
  finalizedById: integer('finalized_by_id'),
  finalizationSnapshot: jsonb('finalization_snapshot'),
});

export type MigrationProject = typeof migrationProjectsTable.$inferSelect;
export type NewMigrationProject = typeof migrationProjectsTable.$inferInsert;

export const sourceFilesTable = pgTable('source_files', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  fileName: text('file_name').notNull(),
  rowCount: integer('row_count').notNull().default(0),
  columns: text('columns').array().notNull().default([]),
  status: sourceFileStatusEnum('status').notNull().default('processing'),
  uploadedById: integer('uploaded_by_id').notNull(),
  uploadedAt: timestamp('uploaded_at').defaultNow(),
});

export type SourceFile = typeof sourceFilesTable.$inferSelect;
export type NewSourceFile = typeof sourceFilesTable.$inferInsert;

export const destinationFieldsTable = pgTable('destination_fields', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  fieldName: text('field_name').notNull(),
  fieldType: fieldTypeEnum('field_type').notNull().default('text'),
  required: boolean('required').notNull().default(false),
  isUnique: boolean('is_unique').notNull().default(false),
  sourceMapping: text('source_mapping'),
  allowedValues: text('allowed_values').array(),
  description: text('description'),
  status: fieldStatusEnum('status').notNull().default('missing'),
  requirementSource: requirementSourceEnum('requirement_source').notNull().default('manual'),
  isConfirmed: boolean('is_confirmed').notNull().default(false),
  confirmedById: integer('confirmed_by_id'),
  confirmedAt: timestamp('confirmed_at'),
  suggestionReasoning: text('suggestion_reasoning'),
  observedSampleValues: text('observed_sample_values').array(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export type DestinationField = typeof destinationFieldsTable.$inferSelect;
export type NewDestinationField = typeof destinationFieldsTable.$inferInsert;

export const validationRulesTable = pgTable('validation_rules', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  fieldId: integer('field_id'),
  name: text('name').notNull(),
  ruleType: ruleTypeEnum('rule_type').notNull(),
  ruleConfig: jsonb('rule_config'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

export type ValidationRule = typeof validationRulesTable.$inferSelect;
export type NewValidationRule = typeof validationRulesTable.$inferInsert;

export const migrationRecordsTable = pgTable('migration_records', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  sourceFileId: integer('source_file_id').notNull(),
  rowNumber: integer('row_number').notNull(),
  data: jsonb('data').notNull(),
  status: recordStatusEnum('status').notNull().default('pending'),
  aiConfidence: real('ai_confidence'),
  aiReasoning: text('ai_reasoning'),
  aiIssueType: text('ai_issue_type'),
  aiIssueSummary: text('ai_issue_summary'),
  validationErrors: jsonb('validation_errors'),
  destinationRuleFindings: jsonb('destination_rule_findings'),
  aiAnalysisFindings: jsonb('ai_analysis_findings'),
  reviewedById: integer('reviewed_by_id'),
  reviewedAt: timestamp('reviewed_at'),
  reviewNote: text('review_note'),
  recommendedDisposition: text('recommended_disposition'),
  recommendedDispositionReason: text('recommended_disposition_reason'),
  duplicateRecordIds: jsonb('duplicate_record_ids'),
  duplicateConfidence: real('duplicate_confidence'),
  duplicateEvidence: jsonb('duplicate_evidence'),
  suggestedQuestion: text('suggested_question'),
  createdAt: timestamp('created_at').defaultNow(),
});

export type MigrationRecord = typeof migrationRecordsTable.$inferSelect;
export type NewMigrationRecord = typeof migrationRecordsTable.$inferInsert;

export const recordDiscussionsTable = pgTable('record_discussions', {
  id: serial('id').primaryKey(),
  recordId: integer('record_id').notNull(),
  projectId: integer('project_id').notNull(),
  content: text('content').notNull(),
  title: text('title'),
  stakeholder: text('stakeholder'),
  notes: text('notes'),
  discussionStatus: text('discussion_status').notNull().default('open'),
  resolution: text('resolution'),
  resolvedAt: timestamp('resolved_at'),
  resolvedById: integer('resolved_by_id'),
  findingRef: text('finding_ref'),
  stakeholderId: integer('stakeholder_id'),
  linkedRecordIds: jsonb('linked_record_ids'),
  participants: jsonb('participants'),
  notifyByEmail: boolean('notify_by_email').notNull().default(false),
  createdById: integer('created_by_id').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export type RecordDiscussion = typeof recordDiscussionsTable.$inferSelect;
export type NewRecordDiscussion = typeof recordDiscussionsTable.$inferInsert;

export const auditLogTable = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  recordId: integer('record_id'),
  action: text('action').notNull(),
  details: text('details'),
  previousState: text('previous_state'),
  newState: text('new_state'),
  reason: text('reason'),
  linkedRecordIds: jsonb('linked_record_ids'),
  actionContext: jsonb('action_context'),
  performedById: integer('performed_by_id').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export type AuditLog = typeof auditLogTable.$inferSelect;
export type NewAuditLog = typeof auditLogTable.$inferInsert;

export const referenceFilesTable = pgTable('reference_files', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  fileName: text('file_name').notNull(),
  rowCount: integer('row_count').notNull().default(0),
  columns: text('columns').array().notNull().default([]),
  status: text('status').notNull().default('complete'),
  data: jsonb('data'),
  uploadedById: integer('uploaded_by_id').notNull(),
  uploadedAt: timestamp('uploaded_at').defaultNow(),
});

export type ReferenceFile = typeof referenceFilesTable.$inferSelect;
export type NewReferenceFile = typeof referenceFilesTable.$inferInsert;

export const consolidationsTable = pgTable('consolidations', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  survivingRecordId: integer('surviving_record_id').notNull(),
  mergedRecordIds: jsonb('merged_record_ids').notNull().default([]),
  fieldSelections: jsonb('field_selections').notNull().default({}),
  reason: text('reason'),
  performedById: integer('performed_by_id').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export type Consolidation = typeof consolidationsTable.$inferSelect;
export type NewConsolidation = typeof consolidationsTable.$inferInsert;

export const migrationStakeholdersTable = pgTable('migration_stakeholders', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  organization: text('organization').notNull().default('source'),
  role: text('role').notNull().default('Other'),
  isAppUser: boolean('is_app_user').notNull().default(false),
  notes: text('notes'),
  createdById: integer('created_by_id').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export type MigrationStakeholder = typeof migrationStakeholdersTable.$inferSelect;
export type NewMigrationStakeholder = typeof migrationStakeholdersTable.$inferInsert;

export const discussionResponsesTable = pgTable('discussion_responses', {
  id: serial('id').primaryKey(),
  discussionId: integer('discussion_id').notNull(),
  projectId: integer('project_id').notNull(),
  content: text('content').notNull(),
  isInternal: boolean('is_internal').notNull().default(false),
  createdById: integer('created_by_id').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export type DiscussionResponse = typeof discussionResponsesTable.$inferSelect;
export type NewDiscussionResponse = typeof discussionResponsesTable.$inferInsert;

export const notificationsTable = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  projectId: integer('project_id').notNull(),
  discussionId: integer('discussion_id'),
  recordId: integer('record_id'),
  title: text('title').notNull(),
  message: text('message').notNull(),
  isRead: boolean('is_read').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

export type Notification = typeof notificationsTable.$inferSelect;
export type NewNotification = typeof notificationsTable.$inferInsert;

export const migrationValuesTable = pgTable('migration_values', {
  id: serial('id').primaryKey(),
  recordId: integer('record_id').notNull(),
  projectId: integer('project_id').notNull(),
  fieldName: text('field_name').notNull(),
  originalSourceValue: text('original_source_value'),
  migrationValue: text('migration_value'),
  previousMigrationValue: text('previous_migration_value'),
  changedById: integer('changed_by_id').notNull(),
  changedAt: timestamp('changed_at').defaultNow(),
  reason: text('reason'),
  discussionId: integer('discussion_id'),
});

export type MigrationValue = typeof migrationValuesTable.$inferSelect;
export type NewMigrationValue = typeof migrationValuesTable.$inferInsert;