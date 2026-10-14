import pg from "pg";

// A pool reuses connections instead of opening a new one per request.
export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString });
}

export type Db = Pick<pg.Pool, "query">;
