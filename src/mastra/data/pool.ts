import pg from 'pg';

let pool: pg.Pool | undefined;

export function getSupabasePool(): pg.Pool {
  if (pool) return pool;

  const connectionString = process.env.SUPABASE_READONLY_URL;
  if (!connectionString) {
    throw new Error(
      'SUPABASE_READONLY_URL is required for the Data Agent. ' +
        'Create a read-only Postgres role in Supabase and set this env var to its connection string.',
    );
  }

  pool = new pg.Pool({
    connectionString,
    ssl: process.env.SUPABASE_DATA_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
  });

  return pool;
}
