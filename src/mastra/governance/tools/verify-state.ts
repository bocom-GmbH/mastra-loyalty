import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getSupabasePool } from '../../data/pool';

export const verifyStateTool = createTool({
  id: 'verify-state',
  description:
    'Read-only inspection of the post-migration database state. Used by the post-execution verifier to compare reality against a spec.',
  inputSchema: z.object({
    schema: z.string().default('public'),
    table: z.string().optional().describe('If set, returns column/constraint/index detail for one table.'),
  }),
  outputSchema: z.object({
    schema: z.string(),
    table: z.string().nullable(),
    tables: z.array(z.string()),
    columns: z.array(
      z.object({
        table: z.string(),
        name: z.string(),
        dataType: z.string(),
        isNullable: z.boolean(),
      }),
    ),
    indexes: z.array(z.object({ table: z.string(), name: z.string(), definition: z.string() })),
    constraints: z.array(z.object({ table: z.string(), name: z.string(), type: z.string(), definition: z.string() })),
  }),
  execute: async ({ schema = 'public', table }) => {
    const pool = getSupabasePool();
    const tableFilter = table ? 'AND c.relname = $2' : '';
    const params: unknown[] = [schema];
    if (table) params.push(table);

    const tablesQuery = await pool.query(
      `SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind = 'r' ${tableFilter} ORDER BY relname`,
      params,
    );
    const columnsQuery = await pool.query(
      `
      SELECT table_name, column_name, data_type, is_nullable = 'YES' AS is_nullable
      FROM information_schema.columns
      WHERE table_schema = $1 ${table ? 'AND table_name = $2' : ''}
      ORDER BY table_name, ordinal_position
      `,
      params,
    );
    const indexesQuery = await pool.query(
      `
      SELECT t.relname AS table_name, i.relname AS index_name, pg_get_indexdef(i.oid) AS definition
      FROM pg_class t JOIN pg_index ix ON ix.indrelid = t.oid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = $1 AND t.relkind = 'r' ${table ? 'AND t.relname = $2' : ''}
      ORDER BY t.relname, i.relname
      `,
      params,
    );
    const constraintsQuery = await pool.query(
      `
      SELECT t.relname AS table_name, c.conname AS name,
             CASE c.contype WHEN 'p' THEN 'primary_key' WHEN 'f' THEN 'foreign_key' WHEN 'u' THEN 'unique' WHEN 'c' THEN 'check' ELSE c.contype::text END AS type,
             pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = $1 ${table ? 'AND t.relname = $2' : ''}
      ORDER BY t.relname, c.conname
      `,
      params,
    );

    return {
      schema,
      table: table ?? null,
      tables: tablesQuery.rows.map((r) => r.relname),
      columns: columnsQuery.rows.map((r) => ({
        table: r.table_name,
        name: r.column_name,
        dataType: r.data_type,
        isNullable: r.is_nullable,
      })),
      indexes: indexesQuery.rows.map((r) => ({
        table: r.table_name,
        name: r.index_name,
        definition: r.definition,
      })),
      constraints: constraintsQuery.rows.map((r) => ({
        table: r.table_name,
        name: r.name,
        type: r.type,
        definition: r.definition,
      })),
    };
  },
});
