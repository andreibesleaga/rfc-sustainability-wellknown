// Next.js (App Router): app/.well-known/sustainability-data/route.ts
import { readFile } from "node:fs/promises";
import path from "node:path";

const HEADERS = {
  "Content-Type": "application/sustainability-data+json",
  "X-Content-Type-Options": "nosniff",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=86400",
};
const file = path.join(process.cwd(), "data", "sustainability-data.json"); // keep the source file outside public/

export async function GET() {
  return new Response(await readFile(file), { status: 200, headers: HEADERS });
}
export async function HEAD() {
  return new Response(null, { status: 200, headers: HEADERS });
}
export const dynamic = "force-static";
