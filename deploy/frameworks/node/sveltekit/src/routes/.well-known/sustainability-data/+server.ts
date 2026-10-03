// SvelteKit: src/routes/.well-known/sustainability-data/+server.ts
import { readFile } from "node:fs/promises";
import type { RequestHandler } from "@sveltejs/kit";

const HEADERS = {
  "Content-Type": "application/sustainability-data+json",
  "X-Content-Type-Options": "nosniff",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=86400",
};
export const GET: RequestHandler = async () => new Response(await readFile("data/sustainability-data.json"), { headers: HEADERS });
export const HEAD: RequestHandler = async () => new Response(null, { headers: HEADERS });
// Not prerendered: a prerendered endpoint loses its headers and its HEAD export. With adapter-static use the host's
// header file (deploy/static) instead of this route.
export const prerender = false;
