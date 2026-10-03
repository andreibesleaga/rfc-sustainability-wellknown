// Astro: src/pages/.well-known/sustainability-data.ts — a SERVER endpoint: needs an adapter (@astrojs/node,
// /vercel, /netlify, /cloudflare) and must not be prerendered, or the headers and HEAD are lost. Without an
// adapter, use the host's header file (deploy/static) and a plain file instead.
import { readFile } from "node:fs/promises";
import type { APIRoute } from "astro";

const HEADERS = {
  "Content-Type": "application/sustainability-data+json",
  "X-Content-Type-Options": "nosniff",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=86400",
};
export const prerender = false;

export const GET: APIRoute = async () => new Response(await readFile("data/sustainability-data.json"), { headers: HEADERS });
export const HEAD: APIRoute = async () => new Response(null, { headers: HEADERS });
