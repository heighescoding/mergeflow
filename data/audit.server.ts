import { server, db, currentUser } from '@aha-app/builder-core';
import { eq, desc } from 'drizzle-orm';
import { auditLogTable, usersTable, type AuditLog } from '@/db/schema';

export interface AuditLogEntry extends AuditLog {
  userFirstName: string | null;
  userLastName: string | null;
  userEmail: string;
}

export async function getAuditLog(input: { projectId: number; limit?: number }): Promise<AuditLogEntry[]> {
  const rows = await db
    .select({
      id: auditLogTable.id,
      projectId: auditLogTable.projectId,
      recordId: auditLogTable.recordId,
      action: auditLogTable.action,
      details: auditLogTable.details,
      previousState: auditLogTable.previousState,
      newState: auditLogTable.newState,
      reason: auditLogTable.reason,
      linkedRecordIds: auditLogTable.linkedRecordIds,
      actionContext: auditLogTable.actionContext,
      performedById: auditLogTable.performedById,
      createdAt: auditLogTable.createdAt,
      userFirstName: usersTable.firstName,
      userLastName: usersTable.lastName,
      userEmail: usersTable.email,
    })
    .from(auditLogTable)
    .leftJoin(usersTable, eq(auditLogTable.performedById, usersTable.id))
    .where(eq(auditLogTable.projectId, input.projectId))
    .orderBy(desc(auditLogTable.createdAt))
    .limit(input.limit ?? 200);

  return rows.map(r => ({
    ...r,
    userEmail: r.userEmail ?? 'Unknown',
  }));
}

server.data('getAuditLog', getAuditLog);
