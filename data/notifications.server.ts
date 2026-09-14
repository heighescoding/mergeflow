import { server, db, currentUser, captureError } from '@aha-app/builder-core';
import { eq, and, desc } from 'drizzle-orm';
import { notificationsTable, usersTable, type Notification } from '@/db/schema';

export async function getNotifications(input: { projectId?: number; limit?: number }): Promise<{
  notifications: Notification[];
  unreadCount: number;
}> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const conditions = [eq(notificationsTable.userId, user.id)];
  if (input.projectId) {
    conditions.push(eq(notificationsTable.projectId, input.projectId));
  }

  const notifications = await db.select()
    .from(notificationsTable)
    .where(and(...conditions))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(input.limit ?? 30);

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return { notifications, unreadCount };
}

export async function markNotificationRead(input: { notificationId: number }): Promise<void> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  await db.update(notificationsTable)
    .set({ isRead: true })
    .where(and(
      eq(notificationsTable.id, input.notificationId),
      eq(notificationsTable.userId, user.id),
    ));
}

export async function markAllNotificationsRead(input: { projectId?: number }): Promise<void> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const conditions = [
    eq(notificationsTable.userId, user.id),
    eq(notificationsTable.isRead, false),
  ];
  if (input.projectId) {
    conditions.push(eq(notificationsTable.projectId, input.projectId));
  }

  await db.update(notificationsTable)
    .set({ isRead: true })
    .where(and(...conditions));
}

export async function getAppUsers(input: { projectId: number }): Promise<Array<{
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
}>> {
  // Returns all app users so the discussion creator can select participants
  const users = await db.select({
    id: usersTable.id,
    email: usersTable.email,
    firstName: usersTable.firstName,
    lastName: usersTable.lastName,
    avatarUrl: usersTable.avatarUrl,
  }).from(usersTable).orderBy(usersTable.firstName);

  return users;
}

server.data('getNotifications', getNotifications);
server.data('markNotificationRead', markNotificationRead);
server.data('markAllNotificationsRead', markAllNotificationsRead);
server.data('getAppUsers', getAppUsers);
