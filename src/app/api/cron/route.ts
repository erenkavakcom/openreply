import type { NextRequest } from "next/server";
import { hasDatabase } from "@/lib/db";
import { processQueue } from "@/lib/instagram";

// Sends the DMs waiting in the queue. Vercel Cron calls it (vercel.json) with "Authorization: Bearer <CRON_SECRET>";
// an outside scheduler (cron-job.org) can call /api/cron?key=<CRON_SECRET> every few minutes instead.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? req.nextUrl.searchParams.get("key") ?? "";
  if (!secret || given !== secret) return new Response("Forbidden", { status: 403 });
  if (!hasDatabase()) return new Response("Not ready", { status: 503 });
  await processQueue(40);
  return Response.json({ ok: true });
}
