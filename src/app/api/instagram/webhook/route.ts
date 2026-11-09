import { timingSafeEqual } from "node:crypto";
import { after, type NextRequest } from "next/server";
import { hasDatabase } from "@/lib/db";
import { handleComment, handleMessage, processQueue, readIg, validSignature, type CommentChange, type IncomingMessage } from "@/lib/instagram";

// Meta's webhook for the Instagram app. GET: the one-time check when the address is saved in the Meta app.
// POST: new comments. We answer Meta at once and send the DMs right after, so Meta never times out and retries.

/** Meta's comment notifications are a few KB; anything far larger is not from Meta and is refused unread. */
const MAX_BODY = 256 * 1024;
/** Serverless hosts (Vercel) stop a function after this many seconds; the work below fits well inside it. */
export const maxDuration = 60;

/** At most this many comments from one call are handled (Meta batches a handful). */
const MAX_COMMENTS = 50;

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (!hasDatabase()) return new Response("Not ready", { status: 503 });
  const { verifyToken } = await readIg();
  const given = p.get("hub.verify_token") ?? "";
  if (p.get("hub.mode") === "subscribe" && verifyToken && same(given, verifyToken)) {
    // echo only what Meta's challenge looks like (digits), never arbitrary text
    const challenge = (p.get("hub.challenge") ?? "").replace(/[^\w-]/g, "").slice(0, 200);
    return new Response(challenge, { headers: { "content-type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

type Payload = {
  object?: string;
  entry?: { id?: string; changes?: { field?: string; value?: CommentChange }[]; messaging?: IncomingMessage[] }[];
};

export async function POST(req: NextRequest) {
  if (!hasDatabase()) return new Response("Not ready", { status: 503 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return new Response("Too large", { status: 413 });
  const body = await req.text();
  if (body.length > MAX_BODY) return new Response("Too large", { status: 413 });

  const { appSecret } = await readIg();
  if (!appSecret || !validSignature(body, req.headers.get("x-hub-signature-256"), appSecret)) {
    return new Response("Bad signature", { status: 401 });
  }

  let payload: Payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (payload.object !== "instagram") return new Response("EVENT_RECEIVED");

  const comments: [string, CommentChange][] = [];
  const messages: [string, IncomingMessage][] = [];
  for (const entry of payload.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      if ((ch.field === "comments" || ch.field === "live_comments") && typeof ch.value?.id === "string") comments.push([String(entry.id ?? ""), ch.value]);
    }
    // DMs to us: only the "followed" taps of follow-gated rules are acted on
    for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) messages.push([String(entry.id ?? ""), m]);
  }
  after(async () => {
    for (const [account, c] of comments.slice(0, MAX_COMMENTS)) await handleComment(account, c).catch((e) => console.error("[instagram webhook]", e));
    for (const [account, m] of messages.slice(0, MAX_COMMENTS)) await handleMessage(account, m).catch((e) => console.error("[instagram webhook]", e));
    // anything waiting in the queue goes out too
    await processQueue(10);
  });
  return new Response("EVENT_RECEIVED");
}
