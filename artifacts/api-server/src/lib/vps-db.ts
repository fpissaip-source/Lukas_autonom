import pg from "pg";

const { Pool } = pg;

let _pool: pg.Pool | null = null;

// Reads from the VPS trading database when VPS_DATABASE_URL is set,
// otherwise falls back to the local Lukas database (same table schema).
export function getPool(): pg.Pool | null {
  if (_pool) return _pool;
  const url = process.env["VPS_DATABASE_URL"] ?? process.env["DATABASE_URL"];
  if (!url) return null;
  _pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 3000 });
  return _pool;
}

export async function queryRows<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not configured");
  const result = await pool.query<T>(sql, params);
  return result.rows;
}
