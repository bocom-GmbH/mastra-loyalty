import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getSupabasePool } from '../../data/pool';

type CheckResult = { name: string; status: 'pass' | 'fail' | 'warn'; details: string };

async function checkFkIndexes(schema: string): Promise<CheckResult> {
  const pool = getSupabasePool();
  const { rows } = await pool.query(
    `
    SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE c.contype = 'f'
      AND n.nspname = $1
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND a.attnum = ANY(i.indkey)
      )
    `,
    [schema],
  );
  if (rows.length === 0) return { name: 'fk_indexes', status: 'pass', details: 'All FK columns are indexed.' };
  return {
    name: 'fk_indexes',
    status: 'fail',
    details: `Unindexed FK columns: ${rows.map((r) => `${r.table_name}.${r.column_name}`).join(', ')}`,
  };
}

async function checkRlsEnabled(schema: string): Promise<CheckResult> {
  const pool = getSupabasePool();
  const { rows } = await pool.query(
    `
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relkind = 'r' AND NOT c.relrowsecurity
    `,
    [schema],
  );
  if (rows.length === 0) return { name: 'rls_enabled', status: 'pass', details: 'RLS enabled on every table.' };
  return {
    name: 'rls_enabled',
    status: 'fail',
    details: `Tables without RLS: ${rows.map((r) => r.table_name).join(', ')}`,
  };
}

async function checkTimestamptz(schema: string): Promise<CheckResult> {
  const pool = getSupabasePool();
  const { rows } = await pool.query(
    `
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = $1
      AND column_name IN ('created_at', 'updated_at', 'deleted_at')
      AND data_type = 'timestamp without time zone'
    `,
    [schema],
  );
  if (rows.length === 0) return { name: 'timestamptz', status: 'pass', details: 'All audit columns use timestamptz.' };
  return {
    name: 'timestamptz',
    status: 'fail',
    details: `Non-timestamptz audit columns: ${rows.map((r) => `${r.table_name}.${r.column_name}`).join(', ')}`,
  };
}

async function checkAuditColumns(schema: string): Promise<CheckResult> {
  const pool = getSupabasePool();
  const { rows } = await pool.query(
    `
    SELECT c.relname AS table_name,
           EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = c.relname AND column_name = 'created_at') AS has_created,
           EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = c.relname AND column_name = 'updated_at') AS has_updated
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relkind = 'r'
    `,
    [schema],
  );
  const missing = rows.filter((r) => !r.has_created);
  if (missing.length === 0) return { name: 'audit_columns', status: 'pass', details: 'All tables have created_at.' };
  return {
    name: 'audit_columns',
    status: 'warn',
    details: `Tables missing created_at: ${missing.map((r) => r.table_name).join(', ')}`,
  };
}

async function checkNaming(schema: string): Promise<CheckResult> {
  const pool = getSupabasePool();
  const { rows } = await pool.query(
    `
    SELECT c.relname AS name, c.relkind AS kind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
      AND c.relkind IN ('r','i','v','m')
      AND c.relname !~ '^[a-z][a-z0-9_]*$'
    `,
    [schema],
  );
  if (rows.length === 0) return { name: 'naming', status: 'pass', details: 'All identifiers are lowercase snake_case.' };
  return {
    name: 'naming',
    status: 'fail',
    details: `Non-snake_case names: ${rows.map((r) => r.name).join(', ')}`,
  };
}

export const auditChecklistTool = createTool({
  id: 'audit-checklist',
  description:
    'Run the automated portion of the PostgreSQL/Supabase pre-production checklist against a schema. Read-only.',
  inputSchema: z.object({
    schema: z.string().default('public').describe('Schema to audit.'),
  }),
  outputSchema: z.object({
    schema: z.string(),
    summary: z.object({
      total: z.number(),
      passed: z.number(),
      warnings: z.number(),
      failed: z.number(),
    }),
    checks: z.array(
      z.object({
        name: z.string(),
        status: z.enum(['pass', 'fail', 'warn']),
        details: z.string(),
      }),
    ),
  }),
  execute: async ({ schema = 'public' }) => {
    const checks: CheckResult[] = await Promise.all([
      checkFkIndexes(schema),
      checkRlsEnabled(schema),
      checkTimestamptz(schema),
      checkAuditColumns(schema),
      checkNaming(schema),
    ]);
    return {
      schema,
      summary: {
        total: checks.length,
        passed: checks.filter((c) => c.status === 'pass').length,
        warnings: checks.filter((c) => c.status === 'warn').length,
        failed: checks.filter((c) => c.status === 'fail').length,
      },
      checks,
    };
  },
});
