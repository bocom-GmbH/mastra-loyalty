import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getAdminPool } from '../pool';

const DESTRUCTIVE_PATTERNS = [
  /\bDROP\s+(TABLE|COLUMN|INDEX|VIEW|MATERIALIZED\s+VIEW|SCHEMA|TYPE|TRIGGER|FUNCTION|CONSTRAINT)\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\s+TABLE\s+\S+\s+(DROP|ALTER\s+COLUMN\s+\S+\s+TYPE|ALTER\s+COLUMN\s+\S+\s+DROP)/i,
  /\bDELETE\s+FROM\b/i,
];

function isDestructive(sql: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((p) => p.test(sql));
}

function mentionsBackup(spec: string): boolean {
  return /\bbackup\b|\bbak_\b|\bpg_dump\b|\bwal_checkpoint\b|\blitestream\b/i.test(spec);
}

export const runDdlTool = createTool({
  id: 'run-ddl',
  description:
    'Execute a database design spec against the admin connection. Refuses to run destructive DDL unless the spec text explicitly mentions a backup. This is the ONLY tool allowed to write to the database.',
  inputSchema: z.object({
    specId: z.string().describe('Unique spec ID, e.g. "SPEC-008".'),
    specText: z
      .string()
      .describe(
        'The full spec text. Must include backup plan, rollback plan, and the DDL/DML to execute. Used to enforce the destructive-DDL-requires-backup rule.',
      ),
    sql: z.string().describe('The SQL to execute. May contain multiple statements.'),
    confirmBackupCompleted: z
      .boolean()
      .default(false)
      .describe(
        'Set to true ONLY after a backup has been taken externally and verified. Required for destructive DDL.',
      ),
  }),
  outputSchema: z.object({
    specId: z.string(),
    executed: z.boolean(),
    refusalReason: z.string().nullable(),
    statementsRun: z.number(),
    durationMs: z.number(),
  }),
  execute: async ({ specId, specText, sql, confirmBackupCompleted }) => {
    const destructive = isDestructive(sql);
    if (destructive && !confirmBackupCompleted) {
      return {
        specId,
        executed: false,
        refusalReason:
          'Destructive DDL detected (DROP/TRUNCATE/DELETE/ALTER DROP/TYPE change) but confirmBackupCompleted=false. Take a backup, verify it, and re-call with confirmBackupCompleted=true.',
        statementsRun: 0,
        durationMs: 0,
      };
    }
    if (destructive && !mentionsBackup(specText)) {
      return {
        specId,
        executed: false,
        refusalReason:
          'Destructive DDL detected but the spec text does not mention a backup plan. Update the spec with a backup naming and verification step before retrying.',
        statementsRun: 0,
        durationMs: 0,
      };
    }

    const pool = getAdminPool();
    const client = await pool.connect();
    const start = Date.now();
    let statementsRun = 0;
    try {
      await client.query('BEGIN');
      const statements = sql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter((s) => s.length > 0);
      for (const stmt of statements) {
        await client.query(stmt);
        statementsRun++;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    return {
      specId,
      executed: true,
      refusalReason: null,
      statementsRun,
      durationMs: Date.now() - start,
    };
  },
});
