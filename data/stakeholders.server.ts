import { server, db, currentUser, captureError } from '@aha-app/builder-core';
import { eq, and } from 'drizzle-orm';
import {
  migrationStakeholdersTable,
  type MigrationStakeholder,
  type NewMigrationStakeholder,
} from '@/db/schema';

export async function getStakeholders(input: { projectId: number }): Promise<MigrationStakeholder[]> {
  return db.select()
    .from(migrationStakeholdersTable)
    .where(eq(migrationStakeholdersTable.projectId, input.projectId))
    .orderBy(migrationStakeholdersTable.name);
}

export async function createStakeholder(input: {
  projectId: number;
  name: string;
  email: string;
  organization: string;
  role: string;
  isAppUser?: boolean;
  notes?: string;
}): Promise<MigrationStakeholder> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const [stakeholder] = await db.insert(migrationStakeholdersTable).values({
    projectId: input.projectId,
    name: input.name,
    email: input.email,
    organization: input.organization,
    role: input.role,
    isAppUser: input.isAppUser ?? false,
    notes: input.notes ?? null,
    createdById: user.id,
  }).returning();

  return stakeholder;
}

export async function updateStakeholder(input: {
  id: number;
  projectId: number;
  name?: string;
  email?: string;
  organization?: string;
  role?: string;
  isAppUser?: boolean;
  notes?: string;
}): Promise<MigrationStakeholder> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const updates: Partial<NewMigrationStakeholder> = { updatedAt: new Date() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.email !== undefined) updates.email = input.email;
  if (input.organization !== undefined) updates.organization = input.organization;
  if (input.role !== undefined) updates.role = input.role;
  if (input.isAppUser !== undefined) updates.isAppUser = input.isAppUser;
  if (input.notes !== undefined) updates.notes = input.notes;

  const [stakeholder] = await db.update(migrationStakeholdersTable)
    .set(updates)
    .where(and(
      eq(migrationStakeholdersTable.id, input.id),
      eq(migrationStakeholdersTable.projectId, input.projectId),
    ))
    .returning();

  return stakeholder;
}

export async function deleteStakeholder(input: { id: number; projectId: number }): Promise<void> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  await db.delete(migrationStakeholdersTable)
    .where(and(
      eq(migrationStakeholdersTable.id, input.id),
      eq(migrationStakeholdersTable.projectId, input.projectId),
    ));
}

server.data('getStakeholders', getStakeholders);
server.data('createStakeholder', createStakeholder);
server.data('updateStakeholder', updateStakeholder);
server.data('deleteStakeholder', deleteStakeholder);
