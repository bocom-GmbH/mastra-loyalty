import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getSupabasePool } from './pool';

export const listTablesTool = createTool({
  id: 'list-tables',
  description:
    'List all tables in the Supabase database, including their schema and a row count estimate. Use this first to discover what data is available.',
  inputSchema: z.object({
    schema: z
      .string()
      .optional()
      .describe('Optional schema filter (defaults to "public"). Use "*" to list every schema.'),
  }),
  outputSchema: z.object({
    tables: z.array(
      z.object({
        schema: z.string(),
        name: z.string(),
        kind: z.string(),
        estimatedRows: z.number().nullable(),
      }),
    ),
  }),
  execute: async ({ schema }) => {
    const pool = getSupabasePool();
    const target = schema ?? 'public';
    const params: unknown[] = [];
    let where = "n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')";
    if (target !== '*') {
      params.push(target);
      where = `n.nspname = $${params.length}`;
    }
    const { rows } = await pool.query(
      `
      SELECT
        n.nspname AS schema,
        c.relname AS name,
        CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view' WHEN 'p' THEN 'partitioned_table' ELSE c.relkind::text END AS kind,
        c.reltuples::bigint AS estimated_rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r','v','m','p') AND ${where}
      ORDER BY n.nspname, c.relname
      `,
      params,
    );
    return {
      tables: rows.map((r) => ({
        schema: r.schema,
        name: r.name,
        kind: r.kind,
        estimatedRows: r.estimated_rows === null ? null : Number(r.estimated_rows),
      })),
    };
  },
});

export const describeTableTool = createTool({
  id: 'describe-table',
  description:
    'Describe the columns, types, nullability and primary key of a table. Use this to understand a table before writing a query against it.',
  inputSchema: z.object({
    schema: z.string().default('public').describe('Schema name (defaults to "public").'),
    table: z.string().describe('Table or view name.'),
  }),
  outputSchema: z.object({
    schema: z.string(),
    table: z.string(),
    columns: z.array(
      z.object({
        name: z.string(),
        dataType: z.string(),
        isNullable: z.boolean(),
        default: z.string().nullable(),
        isPrimaryKey: z.boolean(),
      }),
    ),
  }),
  execute: async ({ schema = 'public', table }) => {
    const pool = getSupabasePool();
    const { rows } = await pool.query(
      `
      SELECT
        c.column_name,
        c.data_type,
        c.is_nullable = 'YES' AS is_nullable,
        c.column_default,
        EXISTS (
          SELECT 1
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = c.table_schema
            AND tc.table_name = c.table_name
            AND kcu.column_name = c.column_name
        ) AS is_primary_key
      FROM information_schema.columns c
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position
      `,
      [schema, table],
    );
    return {
      schema,
      table,
      columns: rows.map((r) => ({
        name: r.column_name,
        dataType: r.data_type,
        isNullable: r.is_nullable,
        default: r.column_default,
        isPrimaryKey: r.is_primary_key,
      })),
    };
  },
});

export const runQueryTool = createTool({
  id: 'run-query',
  description:
    'Execute a SQL query against the Supabase database and return the rows. The connection is read-only at the database level. Prefer SELECT statements with explicit columns and LIMIT clauses.',
  inputSchema: z.object({
    sql: z.string().describe('The SQL statement to execute.'),
    params: z
      .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .optional()
      .describe('Optional positional parameters bound as $1, $2, ...'),
  }),
  outputSchema: z.object({
    rowCount: z.number(),
    rows: z.array(z.record(z.string(), z.unknown())),
  }),
  execute: async ({ sql, params }) => {
    const pool = getSupabasePool();
    const result = await pool.query(sql, params ?? []);
    return {
      rowCount: result.rowCount ?? result.rows.length,
      rows: result.rows as Array<Record<string, unknown>>,
    };
  },
});
