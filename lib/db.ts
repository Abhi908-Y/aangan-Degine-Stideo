import { neon, NeonQueryFunction } from "@neondatabase/serverless";

// Tagged-template SQL over HTTP (works in Vercel serverless functions).
// Created lazily so `next build` doesn't need DATABASE_URL.
let client: NeonQueryFunction<false, false> | null = null;
export function sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<any[]> {
  // no-store: Next 14 caches fetch() (which the Neon driver uses) in its Data Cache, which froze the dashboard.
  client ??= neon(process.env.DATABASE_URL!, { fetchOptions: { cache: "no-store" } });
  return client(strings, ...values) as Promise<any[]>;
}
