import { pool } from "../db/pool";

const cache = new Map<string, { value: number; expires: number }>();

// Prices used to expire exactly on the hour — all 41 keys at once.
const TTL_MS = 3_600_000;
const JITTER_MS = 300_000;

export async function getPrice(sku: string): Promise<number> {
  const hit = cache.get(sku);
  if (hit && hit.expires > Date.now()) return hit.value;
  const row = await pool.query("SELECT price FROM prices WHERE sku = $1", [sku]);
  const ttl = TTL_MS + Math.floor(Math.random() * JITTER_MS);
  cache.set(sku, { value: row.price, expires: Date.now() + ttl });
  return row.price;
}
