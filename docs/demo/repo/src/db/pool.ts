import { Pool } from "pg";

// One shared pool; checkout saturates it when every price misses at once.
export const pool = new Pool({
  max: 20,
  connectionTimeoutMillis: 2_000,
});
