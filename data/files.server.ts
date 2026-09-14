import { server, db, currentUser } from '@aha-app/builder-core';
import { eq, and, desc } from 'drizzle-orm';
import {
  sourceFilesTable,
  referenceFilesTable,
  migrationRecordsTable,
  auditLogTable,
  type SourceFile,
  type NewSourceFile,
  type ReferenceFile,
  type MigrationRecord,
} from '@/db/schema';

export async function getSourceFiles(input: { projectId: number }): Promise<SourceFile[]> {
  return db.select().from(sourceFilesTable)
    .where(eq(sourceFilesTable.projectId, input.projectId))
    .orderBy(desc(sourceFilesTable.uploadedAt));
}

export async function importSourceFile(input: {
  projectId: number;
  fileName: string;
  columns: string[];
  rows: Record<string, unknown>[];
}): Promise<SourceFile> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const [file] = await db.insert(sourceFilesTable).values({
    projectId: input.projectId,
    fileName: input.fileName,
    rowCount: input.rows.length,
    columns: input.columns,
    status: 'complete',
    uploadedById: user.id,
  }).returning();

  // Insert records in batches of 100
  const batchSize = 100;
  for (let i = 0; i < input.rows.length; i += batchSize) {
    const batch = input.rows.slice(i, i + batchSize).map((row, j) => ({
      projectId: input.projectId,
      sourceFileId: file.id,
      rowNumber: i + j + 1,
      data: row,
      status: 'pending' as const,
    }));
    await db.insert(migrationRecordsTable).values(batch);
  }

  await db.insert(auditLogTable).values({
    projectId: input.projectId,
    action: 'file_imported',
    details: `Imported "${input.fileName}" with ${input.rows.length} records`,
    performedById: user.id,
  });

  return file;
}

export async function deleteSourceFile(input: { id: number; projectId: number }): Promise<void> {
  await db.delete(sourceFilesTable).where(
    and(eq(sourceFilesTable.id, input.id), eq(sourceFilesTable.projectId, input.projectId))
  );
}

server.data('getSourceFiles', getSourceFiles);
server.data('importSourceFile', importSourceFile);
server.data('deleteSourceFile', deleteSourceFile);

export async function getReferenceFiles(input: { projectId: number }): Promise<ReferenceFile[]> {
  return db.select().from(referenceFilesTable)
    .where(eq(referenceFilesTable.projectId, input.projectId))
    .orderBy(desc(referenceFilesTable.uploadedAt));
}

export async function importReferenceFile(input: {
  projectId: number;
  fileName: string;
  columns: string[];
  rows: Record<string, unknown>[];
}): Promise<ReferenceFile> {
  const user = currentUser();
  if (!user) throw new Error('Not authenticated');

  const [file] = await db.insert(referenceFilesTable).values({
    projectId: input.projectId,
    fileName: input.fileName,
    rowCount: input.rows.length,
    columns: input.columns,
    status: 'complete',
    data: input.rows,
    uploadedById: user.id,
  }).returning();

  return file;
}

export async function deleteReferenceFile(input: { id: number; projectId: number }): Promise<void> {
  await db.delete(referenceFilesTable).where(
    and(eq(referenceFilesTable.id, input.id), eq(referenceFilesTable.projectId, input.projectId))
  );
}

server.data('getReferenceFiles', getReferenceFiles);
server.data('importReferenceFile', importReferenceFile);
server.data('deleteReferenceFile', deleteReferenceFile);