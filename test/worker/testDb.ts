import { D1Database } from '@cloudflare/workers-types';
import migration0001 from '../../migrations/0001_initial.sql?raw';
import migration0002 from '../../migrations/0002_batch_imports.sql?raw';

export async function applyMigrations(db: D1Database): Promise<void> {
  const migrations = [migration0001, migration0002];
  for (const sql of migrations) {
    const statements = sql
      .split(';')
      .map((s: string) => s.replace(/--.*$/gm, '').trim())
      .filter((s: string) => s.length > 0);

    for (const stmt of statements) {
      await db.prepare(stmt).run();
    }
  }
}
