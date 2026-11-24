import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Db } from "./db.js";

/**
 * Creates the tables and demo data on an empty database, e.g. a fresh hosted
 * Postgres. Locally, Docker Compose already loads db/*.sql, so this is a no-op.
 * Returns true if it loaded anything.
 */
export async function ensureSchema(db: Db, dir = path.join(process.cwd(), "db")): Promise<boolean> {
  const { rows } = await db.query<{ exists: string | null }>("SELECT to_regclass('public.orders') AS exists");
  if (rows[0]?.exists) return false;

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await db.query(await readFile(path.join(dir, file), "utf8"));
  }
  console.log(`Empty database: loaded ${files.join(", ")}`);
  return true;
}
