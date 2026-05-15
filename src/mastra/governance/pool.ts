import pg from 'pg';

let adminPool: pg.Pool | undefined;

export function getAdminPool(): pg.Pool {
  if (adminPool) return adminPool;

  const connectionString = process.env.SUPABASE_ADMIN_URL;
  if (!connectionString) {
    throw new Error(
      'SUPABASE_ADMIN_URL is required for the migration executor. ' +
        'This must point to a Postgres role with DDL privileges on the target schema. ' +
        'Do NOT reuse SUPABASE_READONLY_URL or DATABASE_URL.',
    );
  }

  adminPool = new pg.Pool({
    connectionString,
    ssl: process.env.SUPABASE_ADMIN_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 2,
    idleTimeoutMillis: 30_000,
    statement_timeout: 60_000,
  });

  return adminPool;
}
