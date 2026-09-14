/**
 * Canonical disposition model for MergeFlow.
 *
 * FINAL dispositions (record is resolved — no further action needed):
 *   - approved     → will be migrated
 *   - consolidated → merged into another record
 *   - excluded     → intentionally not migrated
 *
 * UNRESOLVED dispositions (record still needs a decision):
 *   - pending      → not yet reviewed
 *   - discussing   → in an open discussion (tracked but not finalized)
 *
 * BLOCKING RULE VIOLATIONS:
 *   Rule violations block migration for any record that is NOT excluded
 *   (excluded records will not be migrated, so their violations are irrelevant).
 *   Violations on consolidated records are also irrelevant (already resolved).
 */

export const FINAL_STATUSES = ['approved', 'consolidated', 'excluded'] as const;
export const UNRESOLVED_STATUSES = ['pending', 'discussing'] as const;

export type FinalStatus = (typeof FINAL_STATUSES)[number];
export type UnresolvedStatus = (typeof UNRESOLVED_STATUSES)[number];

export function isFinalStatus(status: string): status is FinalStatus {
  return FINAL_STATUSES.includes(status as FinalStatus);
}

export function isUnresolvedStatus(status: string): status is UnresolvedStatus {
  return UNRESOLVED_STATUSES.includes(status as UnresolvedStatus);
}

/**
 * Returns true if rule violations on a record should block migration completion.
 * Only excluded and consolidated records are exempt.
 */
export function violationsBlockMigration(status: string): boolean {
  return status !== 'excluded' && status !== 'consolidated';
}
