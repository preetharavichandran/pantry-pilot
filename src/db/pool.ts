import pg from "pg";

export type Db = pg.Pool;

/** Keep DATE columns as YYYY-MM-DD strings (pg default is JS Date, which String() localizes). */
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export function createPool(databaseUrl: string): Db {
  return new pg.Pool({ connectionString: databaseUrl });
}
