import { backup as sqliteBackup, type DatabaseSync } from 'node:sqlite';

export type SqliteDatabase = DatabaseSync;

export function runInTransaction<T>(database: SqliteDatabase, operation: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (operationError) {
    try {
      database.exec('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError(
        [operationError, rollbackError],
        'Giao dịch SQLite thất bại và thao tác rollback cũng thất bại.'
      );
    }
    throw operationError;
  }
}

export async function backupSqliteDatabase(
  database: SqliteDatabase,
  destinationPath: string
): Promise<void> {
  await sqliteBackup(database, destinationPath);
}
