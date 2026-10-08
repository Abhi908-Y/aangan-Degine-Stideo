// Runs db/schema.sql then db/seed.sql against DATABASE_URL (Neon).
// Uses the Neon driver instead of psql so `npm run db:setup` works on Windows too.
// DATABASE_URL comes from the environment, or from .env.local (`vercel env pull`).
import { readFileSync, existsSync } from "node:fs";
import { Pool, neonConfig } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL && existsSync(".env.local")) {
  const line = readFileSync(".env.local", "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  if (line) process.env.DATABASE_URL = line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run `vercel env pull .env.local` or set it in your shell.");
  process.exit(1);
}

neonConfig.webSocketConstructor = WebSocket; // Node 22+ has a global WebSocket
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  for (const file of ["db/schema.sql", "db/seed.sql"]) {
    await pool.query(readFileSync(file, "utf8"));
    console.log(`✓ ${file}`);
  }
  const { rows } = await pool.query(
    "SELECT (SELECT count(*) FROM designers) AS designers, (SELECT count(*) FROM designer_slots) AS slots"
  );
  console.log(`Designers: ${rows[0].designers}, open calendar slots: ${rows[0].slots}`);
} finally {
  await pool.end();
}
