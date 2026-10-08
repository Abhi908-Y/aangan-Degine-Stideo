import { neon, NeonQueryFunction } from "@neondatabase/serverless";

// Tagged-template SQL over HTTP (works in Vercel serverless functions).
// Created lazily so `next build` doesn't need DATABASE_URL.
let client: NeonQueryFunction<false, false> | null = null;
export function sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<any[]> {
  client ??= neon(process.env.DATABASE_URL!);
  return client(strings, ...values) as Promise<any[]>;
}
