import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { execute, query } from "@/lib/db";
import { notifyPhone } from "@/lib/notify";

// Instagram auto-DM (the "comment a word, get the link in DM" feature of tools like ManyChat): Meta calls our webhook for every
// new comment; a comment containing a rule's keyword gets a private reply (a DM tied to that comment) and,
// optionally, a short public answer under the comment. Uses the Instagram API with Instagram Login.

// IG_GRAPH_BASE points both hosts at a local stand-in for tests; it is never set in production.
const GRAPH = process.env.IG_GRAPH_BASE || "https://graph.instagram.com/v23.0";
const KEY = "instagram";

export type IgSettings = {
  /** long-lived Instagram user token (60 days, refreshed here before it runs out) */
  token?: string;
  tokenSavedAt?: string;
  tokenExpiresAt?: string;
  /** which Graph host accepted the token when it was saved */
  host?: "instagram" | "facebook";
  /** the professional account's id as webhooks name it, and its @username */
  userId?: string;
  username?: string;
  /** "Instagram app secret" from the app's Instagram API setup page: checks that a webhook call comes from Meta */
  appSecret?: string;
  /** what we answer Meta's webhook check with; made once here and pasted into the Meta app */
  verifyToken?: string;
  /** when each kind of alert was last sent, so a problem is reported once, not on every comment */
  alerts?: Record<string, string>;
};

export type IgRule = {
  id: number;
  keywords: string;
  /** the one post this rule answers on; empty = every post */
  media_id: string;
  /** that post's link as shown in the panel; empty when the rule is for every post */
  media_url: string;
  dm_text: string;
  reply_text: string;
  active: number;
  sent_count: number;
  /** 1 = the link goes only to followers: the first DM asks to follow and offers a "followed" button */
  follow_gate: number;
  /** the first DM of a follow-gated rule; empty = the default text */
  gate_text: string;
};

export const DEFAULT_GATE_TEXT =
  "Selam! 🙌 Linki göndermem için önce hesabımı takip et. Takip ettikten sonra buraya dönüp aşağıdaki \"Takip ettim ✅\" butonuna dokun, link hemen gelsin 👇";
/** the public answer under the comment when a rule leaves its own empty; one of these is picked at random */
export const DEFAULT_REPLY_TEXT = "DM'den gönderdim 🙌 | Gönderdim, mesajlarına bak 📩 | Linki DM'ine attım 🙌";
const GATE_BUTTON = "Takip ettim ✅";
const NOT_YET_TEXT = "Henüz takip etmiyorsun gibi görünüyor 🙂 Takip ettikten sonra butona tekrar dokun 👇";
/** after this many "not following yet" answers we stop replying to that person's taps */
const MAX_GATE_TRIES = 5;

/** The message with a "followed" quick-reply button; the payload ties the tap back to the comment's row. */
const gateMessage = (text: string, eventId: number) => ({
  text,
  quick_replies: [{ content_type: "text", title: GATE_BUTTON, payload: `IGF:${eventId}` }],
});
/** Plain-text fallback for when Instagram refuses the button in a private reply. */
const gatePlain = (text: string) => ({ text: `${text.replace(/\s*👇\s*$/, "")}\n\nTakip ettikten sonra bu mesaja "tamam" yazman yeterli.` });

export type IgEvent = {
  id: number;
  comment_id: string;
  rule_id: number | null;
  username: string;
  comment_text: string;
  /** sending (being sent now), sent, retry (waiting in the queue), gated (waits for a follow), skipped, failed */
  status: string;
  error: string;
  next_try_at: Date | null;
  replied: number;
  created_at: Date;
};

export async function readIg(): Promise<IgSettings> {
  const [row] = await query<{ data: string }>("SELECT data FROM settings WHERE key = ?", [KEY]);
  let s: IgSettings = {};
  try {
    s = row ? JSON.parse(row.data) : {};
  } catch {}
  if (!s.verifyToken) {
    s.verifyToken = randomBytes(18).toString("base64url");
    await writeIg(s);
  }
  return s;
}

export async function writeIg(s: IgSettings) {
  await execute("INSERT INTO settings (key, data) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data", [KEY, JSON.stringify(s)]);
}

type GraphError = { error?: { message?: string; code?: number } };

// Two kinds of token work: an Instagram-login token (60 days) talks to graph.instagram.com; a token from Facebook
// login (a system-user token that never expires, or a page token) talks to graph.facebook.com. Which one a token
// belongs to is found out when it is saved (both are tried) and kept in the settings.
export type IgHost = "instagram" | "facebook";
const HOSTS: Record<IgHost, string> = { instagram: GRAPH, facebook: GRAPH.replace("graph.instagram.com", "graph.facebook.com") };
const guessHost = (token: string): IgHost => (token.startsWith("IG") ? "instagram" : "facebook");

/** Tokens pasted from Meta's dialogs sometimes carry spaces, line breaks, quotes or a "Bearer " prefix. */
export const cleanToken = (t: string) => t.replace(/^\s*bearer\s+/i, "").replace(/[\s"'`]/g, "");

async function graph<T>(path: string, init: RequestInit & { token: string; host?: IgHost }): Promise<T> {
  const { token, host, ...rest } = init;
  const res = await fetch(`${HOSTS[host ?? guessHost(token)]}${path}`, {
    ...rest,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...rest.headers },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data: T & GraphError & { _raw?: string };
  try {
    const parsed = JSON.parse(text);
    data = parsed && typeof parsed === "object" ? parsed : ({ _raw: text.slice(0, 200) } as never);
  } catch {
    data = { _raw: text.slice(0, 200) } as never;
  }
  if (!res.ok || data.error) throw new GraphFail(data.error?.message ?? `Instagram ${res.status}: ${text.slice(0, 200)}`, data.error?.code, res.status);
  return data;
}

/** A Graph API error with Meta's error code and the HTTP status, so a failed send can be sorted (retry or not). */
export class GraphFail extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly status?: number,
  ) {
    super(message);
  }
}

type FailKind = "token" | "retry" | "final";
/** Rate limits, Meta's temporary errors and network problems are retried; a bad token raises an alert. */
function failKind(e: unknown): FailKind {
  if (e instanceof GraphFail) {
    if (e.code === 190 || e.code === 102) return "token";
    if ([1, 2, 4, 17, 32, 341, 613, 80002, 80006].includes(e.code ?? -1) || (e.status ?? 0) >= 500 || e.status === 429) return "retry";
    if (/rate|limit|temporar|try again|unavailable/i.test(e.message)) return "retry";
    return "final";
  }
  // fetch timeouts and dropped connections
  return "retry";
}

/** Checks a pasted token on both Graph hosts and returns the account it belongs to and the host that accepted it. */
export async function whoAmI(token: string, knownId?: string): Promise<{ userId: string; username: string; host: IgHost }> {
  const errors: string[] = [];
  try {
    const me = await graph<{ user_id?: string; id?: string; username?: string }>("/me?fields=user_id,username", { token, host: "instagram" });
    const userId = me.user_id ?? me.id;
    if (userId) return { userId: String(userId), username: me.username ?? "", host: "instagram" };
    errors.push(`instagram: ${Object.keys(me).join(",") || "boş yanıt"}`);
  } catch (e) {
    errors.push(`instagram: ${(e as Error).message}`);
  }
  try {
    await graph("/me?fields=id,name", { token, host: "facebook" });
  } catch (e) {
    errors.push(`facebook: ${(e as Error).message}`);
    throw new Error(errors.join(" | "));
  }
  if (knownId) {
    try {
      const ig = await graph<{ id?: string; username?: string }>(`/${encodeURIComponent(knownId)}?fields=id,username`, { token, host: "facebook" });
      if (ig.id) return { userId: String(ig.id), username: ig.username ?? "", host: "facebook" };
    } catch {}
  }
  try {
    const pages = await graph<{ data?: { instagram_business_account?: { id: string; username?: string } }[] }>(
      "/me/accounts?fields=instagram_business_account{id,username}",
      { token, host: "facebook" },
    );
    const ig = pages.data?.find((p) => p.instagram_business_account)?.instagram_business_account;
    if (ig) return { userId: ig.id, username: ig.username ?? "", host: "facebook" };
  } catch {}
  return { userId: knownId ?? "", username: "", host: "facebook" };
}

/** Fills in the account's id and @username the first time a webhook names it (Facebook-side tokens). */
async function learnAccount(s: IgSettings, accountId: string) {
  if (!accountId || !s.token || s.userId === accountId) return;
  let username = s.username ?? "";
  try {
    username = (await graph<{ username?: string }>(`/${encodeURIComponent(accountId)}?fields=username`, { token: s.token, host: s.host })).username ?? username;
  } catch {}
  await writeIg({ ...s, userId: accountId, username });
}

const DAY = 86_400_000;

/** Days until the token runs out; null for tokens that never expire. */
export const tokenDaysLeft = (s: IgSettings) =>
  s.tokenExpiresAt ? Math.max(0, Math.round((new Date(s.tokenExpiresAt).getTime() - Date.now()) / DAY)) : null;

/** Long-lived tokens last 60 days and can be renewed once they are a day old; renew when under 15 days are left. */
export async function refreshTokenIfDue(s: IgSettings): Promise<IgSettings> {
  if (!s.token || !s.tokenExpiresAt || (s.host ?? guessHost(s.token)) !== "instagram") return s;
  const left = new Date(s.tokenExpiresAt).getTime() - Date.now();
  const age = Date.now() - new Date(s.tokenSavedAt ?? 0).getTime();
  if (left > 15 * DAY || age < DAY) return s;
  const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(s.token)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number } & GraphError;
  if (!res.ok || !data.access_token) {
    console.error("[instagram] token yenilenemedi:", data.error?.message ?? res.status);
    return s;
  }
  const next = {
    ...s,
    token: data.access_token,
    tokenSavedAt: new Date().toISOString(),
    tokenExpiresAt: new Date(Date.now() + (data.expires_in ?? 60 * 86_400) * 1000).toISOString(),
  };
  await writeIg(next);
  return next;
}

/** Meta signs each webhook body with the app secret (header "x-hub-signature-256: sha256=<hex>"). */
export function validSignature(body: string, header: string | null, secret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(body, "utf8").digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Lower-case the Turkish way and keep only letters, digits and spaces, so "LİNK!", "link" and "Link." all match.
export const normalize = (t: string) =>
  t
    .toLocaleLowerCase("tr")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// Edits needed to turn one string into the other: insert, delete, replace, or swap two neighbours. Capped at 2.
function typoDistance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/**
 * Does the keyword start a word of the (normalized) text? Exactly, so Turkish endings count ("link" → "linki",
 * "linkten"); or, for keywords of five letters or more, with one typo ("animasyon" → "animasiyon"). Short keywords
 * stay exact, so "link" never fires on "like".
 */
export function keywordHit(text: string, keyword: string) {
  if (!keyword) return false;
  if (` ${text}`.includes(` ${keyword}`)) return true;
  if (keyword.length < 5) return false;
  let start = 0;
  for (;;) {
    for (const len of [keyword.length - 1, keyword.length, keyword.length + 1]) {
      const cand = text.slice(start, start + len).trimEnd();
      if (cand.length >= keyword.length - 1 && typoDistance(keyword, cand) <= 1) return true;
    }
    const next = text.indexOf(" ", start);
    if (next < 0) return false;
    start = next + 1;
  }
}

/**
 * The rule a comment triggers; see keywordHit for how a keyword matches. A rule written for that post wins over a
 * rule for every post, so the same word ("link") can send a different link under each video and a general one
 * under the rest.
 */
export function matchRule(rules: IgRule[], text: string, mediaId: string) {
  const words = normalize(text);
  const hits = rules.filter(
    (r) =>
      r.active &&
      (!r.media_id || r.media_id === mediaId) &&
      r.keywords
        .split(",")
        .map(normalize)
        .some((k) => keywordHit(words, k)),
  );
  return hits.find((r) => r.media_id) ?? hits[0];
}

/** The code in a post link: instagram.com/reel/<code>/, /reels/<code>/, /p/<code>/ or /tv/<code>/, with or without the account name before it. */
export const shortcodeOf = (link: string) => /instagram\.com\/(?:[\w.]+\/)?(?:reels?|p|tv)\/([\w-]+)/i.exec(link)?.[1] ?? "";

/** How many of the account's posts findMedia walks through (newest first), in pages of 100. */
const FIND_MEDIA_PAGES = 20;

/**
 * The id of the account's post behind a link pasted into a rule. The API has no lookup by link, so the account's
 * posts are read newest first until one has that link's code.
 */
export async function findMedia(link: string): Promise<{ id: string; url: string }> {
  const code = shortcodeOf(link);
  if (!code) throw new Error("Bu bir Instagram gönderi linki değil. Reels ya da gönderi linkini yapıştır (instagram.com/reel/…).");
  const s = await refreshTokenIfDue(await readIg());
  if (!s.token) throw new Error("Instagram bağlı değil; önce bağlantıyı kur.");
  const host = s.host ?? guessHost(s.token);
  const owners = [...new Set([host === "instagram" ? "me" : "", s.userId ? encodeURIComponent(s.userId) : ""].filter(Boolean))];
  let lastError = "";
  for (const who of owners) {
    let after = "";
    try {
      for (let page = 0; page < FIND_MEDIA_PAGES; page++) {
        const res = await graph<{ data?: { id: string; permalink?: string }[]; paging?: { cursors?: { after?: string }; next?: string } }>(
          `/${who}/media?fields=id,permalink&limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`,
          { token: s.token, host },
        );
        const hit = res.data?.find((m) => shortcodeOf(m.permalink ?? "") === code);
        if (hit) return { id: String(hit.id), url: hit.permalink ?? link };
        after = res.paging?.next ? (res.paging.cursors?.after ?? "") : "";
        if (!after) break;
      }
      throw new Error("Bu link hesabındaki gönderiler arasında bulunamadı. Kendi videonun linki olduğundan emin ol.");
    } catch (e) {
      lastError = (e as Error).message;
      if (!(e instanceof GraphFail)) break;
    }
  }
  throw new Error(lastError || "Gönderi bulunamadı.");
}

export type CommentChange = {
  id: string;
  text?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string };
  parent_id?: string;
};

// Limits that keep a viral post within Meta's rules. Private replies are capped by Meta at about 750 an hour per
// account; we stay below it and queue the rest. Public answers are capped much lower: hundreds of near-identical
// replies in an hour is what Instagram's spam filter looks for. Past the cap the DM still goes, the answer is skipped.
export const DM_PER_HOUR = 600;
export const REPLIES_PER_HOUR = 60;
/** One DM per person per rule in this many days, however many times they comment. */
const SAME_PERSON_DAYS = 30;
/** Meta accepts a private reply only within 7 days of the comment. */
const REPLY_WINDOW_DAYS = 7;
/** Wait before each retry (minutes); after the last one the comment is given up. */
const BACKOFF_MIN = [2, 5, 15, 30, 60, 120, 240, 480, 720];

type EventRow = IgEvent & { ig_user_id: string; account_id: string; attempts: number; age_days: number };

const EVENT_COLUMNS = `*, EXTRACT(EPOCH FROM (now() - created_at)) / 86400 AS age_days`;

/** Handles one new comment from the webhook. Each comment is answered at most once. */
export async function handleComment(accountId: string, c: CommentChange) {
  if (!c.id || !c.text || !c.from?.id) return;
  // our own comments (including the public answers we post) never trigger anything
  if (c.from.id === accountId) return;
  const s = await readIg();
  // only our own account's comments: a signed call about any other account is ignored
  if (s.userId && accountId && accountId !== s.userId) return;
  if (c.from.id === s.userId) return;

  const rules = await query<IgRule>("SELECT * FROM ig_rules WHERE active = 1 ORDER BY id");
  const rule = matchRule(rules, c.text, c.media?.id ?? "");
  if (!rule) return;

  const claimed = await execute<{ id: number }>(
    `INSERT INTO ig_events (comment_id, rule_id, username, ig_user_id, account_id, media_id, comment_text, status, claimed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'sending', now()) ON CONFLICT (comment_id) DO NOTHING RETURNING id`,
    [
      c.id.slice(0, 40),
      rule.id,
      (c.from.username ?? "").slice(0, 100),
      c.from.id.slice(0, 40),
      accountId.slice(0, 40),
      (c.media?.id ?? "").slice(0, 40),
      c.text.slice(0, 500),
    ],
  );
  const eventId = claimed.rows[0]?.id;
  if (!eventId) return;
  // records are kept for at most 90 days (the privacy page says so)
  await execute("DELETE FROM ig_events WHERE created_at < now() - interval '90 days'");

  // Someone who comments "link" three times gets one DM. Only earlier rows count, so two comments arriving at the
  // same moment cannot both skip each other.
  const sameRecent = (statuses: string) =>
    query<{ id: number; status: string }>(
      `SELECT id, status FROM ig_events WHERE rule_id = ? AND ig_user_id = ? AND id < ? AND status IN (${statuses})
       AND created_at > now() - make_interval(days => ?) LIMIT 1`,
      [rule.id, c.from!.id!.slice(0, 40), eventId, SAME_PERSON_DAYS],
    );
  const [earlier] = await sameRecent("'sent','sending','retry','gated'");
  if (earlier) {
    // Still waiting for a follow: a new comment (often right after following) gets a fresh private reply, which sends
    // the link straight away if Instagram now reports the follow. The old waiting row steps aside.
    const [other] = earlier.status === "gated" ? await sameRecent("'sent','sending','retry'") : [earlier];
    if (other) return setEvent(eventId, "skipped", "Bu kişiye bu kural için zaten DM gönderildi.");
    await execute("UPDATE ig_events SET status = 'skipped', error = 'Tekrar yorum yaptı, yeni yorumdan devam edildi.' WHERE rule_id = ? AND ig_user_id = ? AND status = 'gated' AND id < ?", [
      rule.id,
      c.from.id.slice(0, 40),
      eventId,
    ]);
  }

  const [row] = await query<EventRow>(`SELECT ${EVENT_COLUMNS} FROM ig_events WHERE id = ?`, [eventId]);
  if (row) await deliver(row, rule);
}

/** Sends the DM (and the public answer) for one claimed event; on a passing problem it goes back to the queue. */
async function deliver(ev: EventRow, rule: IgRule) {
  if (Number(ev.age_days) > REPLY_WINDOW_DAYS - 0.05) return setEvent(ev.id, "failed", "7 gün geçti: Meta bu yoruma artık DM izni vermiyor.");

  let s = await readIg();
  if (!s.token) return retry(ev, "Instagram bağlı değil (token yok).", 60);
  s = await refreshTokenIfDue(s);
  if (ev.account_id) await learnAccount(s, ev.account_id);

  // stay under Meta's hourly cap; the rest waits in the queue (not counted as a failed attempt)
  const [{ n: sentLastHour }] = await query<{ n: string }>("SELECT COUNT(*) AS n FROM ig_events WHERE sent_at > now() - interval '1 hour'");
  if (Number(sentLastHour) >= DM_PER_HOUR) {
    await alert("busy", `Instagram DM: son 1 saatte ${DM_PER_HOUR} DM sınırına ulaşıldı. Yeni yorumlar kuyrukta, sırayla gönderilecek.`, 60);
    return retry(ev, "Saatlik DM sınırı doldu, sırada.", 10, false);
  }

  // A private reply counts as delivered only when Meta returns a message id. Some token kinds answer on another path,
  // so the account's own path is tried first and "me" second. A follow-gated rule first sends the "follow me" message
  // with a button, and falls back to plain text if Instagram refuses the button.
  let gated = Boolean(rule.follow_gate);
  // Instagram may already tell us the commenter follows: then the link goes straight away, no button step.
  if (gated && ev.ig_user_id) {
    const p = await graph<{ is_user_follow_business?: boolean }>(`/${encodeURIComponent(ev.ig_user_id)}?fields=is_user_follow_business`, {
      token: s.token!,
      host: s.host,
    }).catch(() => ({}) as { is_user_follow_business?: boolean });
    if (p.is_user_follow_business === true) gated = false;
  }
  const gateText = rule.gate_text || DEFAULT_GATE_TEXT;
  const messages = gated ? [gateMessage(gateText, ev.id), gatePlain(gateText)] : [{ text: rule.dm_text }];
  const notes: string[] = [];
  let delivered = false;
  let kind: FailKind = "final";
  send: for (const message of messages) {
    const body = JSON.stringify({ recipient: { comment_id: ev.comment_id }, message });
    for (const who of [...new Set([ev.account_id || s.userId, "me"].filter(Boolean))]) {
      try {
        const res = await graph<Record<string, unknown>>(`/${encodeURIComponent(who!)}/messages`, { token: s.token!, host: s.host, method: "POST", body });
        if (res.message_id) {
          delivered = true;
          break send;
        }
        notes.push(`${who}: ${JSON.stringify(res).slice(0, 160)}`);
      } catch (e) {
        notes.push(`${who}: ${(e as Error).message}`);
        const k = failKind(e);
        if (k === "token" || (k === "retry" && kind !== "token")) kind = k;
      }
    }
    // a rate limit or bad token is not about the message's shape: no point trying the plain variant
    if (kind !== "final") break;
  }
  if (!delivered) {
    const why = notes.join(" | ");
    if (kind === "token") {
      await alert("token", "Instagram DM: Meta token'ı reddetti. Panelden yeni token gir. Yorumlar kuyrukta bekliyor.", 360);
      return retry(ev, `Token geçersiz: ${why}`, 30);
    }
    if (kind === "retry") return retry(ev, why);
    await setEvent(ev.id, "failed", `DM teslim edilmedi: ${why}`);
    return watchFailures();
  }
  if (gated) {
    // the link waits for the "followed" tap (handleMessage); the private reply still counts toward the hourly cap
    await execute("UPDATE ig_events SET status = 'gated', sent_at = now(), error = '', next_try_at = NULL WHERE id = ?", [ev.id]);
  } else {
    await execute("UPDATE ig_events SET status = 'sent', sent_at = now(), error = '', next_try_at = NULL WHERE id = ?", [ev.id]);
    await execute("UPDATE ig_rules SET sent_count = sent_count + 1 WHERE id = ?", [rule.id]);
  }

  const replyText = rule.reply_text || DEFAULT_REPLY_TEXT;
  const [{ n: repliesLastHour }] = await query<{ n: string }>("SELECT COUNT(*) AS n FROM ig_events WHERE replied = 1 AND sent_at > now() - interval '1 hour'");
  if (Number(repliesLastHour) >= REPLIES_PER_HOUR) return setNote(ev.id, "Yorum yanıtı saatlik sınır nedeniyle atlandı (DM gitti).");
  try {
    await graph(`/${encodeURIComponent(ev.comment_id)}/replies`, {
      token: s.token!,
      host: s.host,
      method: "POST",
      body: JSON.stringify({ message: pick(replyText) }),
    });
    await execute("UPDATE ig_events SET replied = 1 WHERE id = ?", [ev.id]);
  } catch (e) {
    await setNote(ev.id, `DM gitti, yorum yanıtı gitmedi: ${(e as Error).message}`);
  }
}

/** Puts an event back in the queue with a growing wait; after the last try it is given up. */
async function retry(ev: EventRow, why: string, waitMin?: number, countsAsTry = true) {
  const attempts = Number(ev.attempts ?? 0) + (countsAsTry ? 1 : 0);
  if (attempts > BACKOFF_MIN.length) {
    await setEvent(ev.id, "failed", `Tekrar denemeler bitti: ${why}`);
    return watchFailures();
  }
  const wait = waitMin ?? BACKOFF_MIN[Math.max(0, attempts - 1)];
  await execute("UPDATE ig_events SET status = 'retry', attempts = ?, next_try_at = now() + make_interval(mins => ?), error = ? WHERE id = ?", [
    attempts,
    wait,
    `${countsAsTry ? `Kuyrukta (${attempts}. deneme)` : "Kuyrukta"}: ${why}`.slice(0, 500),
    ev.id,
  ]);
}

const g = globalThis as unknown as { __igRunning?: boolean };
/**
 * Sends what is waiting in the queue: retries that are due, and sends a restart left half done. Runs after each
 * webhook call, when the panel opens, from the scheduled job (/api/cron) and, on a regular server, every two minutes.
 * A row is claimed before it is sent, so two runs at once never send the same DM twice.
 */
export async function processQueue(limit = 40) {
  if (g.__igRunning) return;
  g.__igRunning = true;
  try {
    await execute("UPDATE ig_events SET status = 'retry', next_try_at = now() WHERE status = 'sending' AND claimed_at < now() - interval '10 minutes'");
    const due = await query<EventRow>(`SELECT ${EVENT_COLUMNS} FROM ig_events WHERE status = 'retry' AND next_try_at <= now() ORDER BY id LIMIT ?`, [limit]);
    for (const ev of due) {
      const claim = await execute("UPDATE ig_events SET status = 'sending', claimed_at = now() WHERE id = ? AND status = 'retry'", [ev.id]);
      if (!claim.count) continue;
      const [rule] = await query<IgRule>("SELECT * FROM ig_rules WHERE id = ?", [ev.rule_id]);
      if (!rule || !rule.active) {
        await setEvent(ev.id, "failed", "Kural silindi ya da kapatıldı.");
        continue;
      }
      await deliver(ev, rule);
    }
  } catch (e) {
    console.error("[instagram kuyruk]", e);
  } finally {
    g.__igRunning = false;
  }
}

/** Five or more failures in an hour means something is wrong (Meta rules, settings): tell the owner, at most hourly. */
async function watchFailures() {
  const [{ n }] = await query<{ n: string }>("SELECT COUNT(*) AS n FROM ig_events WHERE status = 'failed' AND created_at > now() - interval '1 hour'");
  if (Number(n) >= 5) await alert("failures", `Instagram DM: son 1 saatte ${n} gönderim başarısız. Paneldeki hatalara bak.`, 60);
}

/** A Telegram message to the owner (if set up), at most once per `everyMin` minutes for the same kind of problem. */
async function alert(kind: string, text: string, everyMin: number) {
  const s = await readIg();
  const last = s.alerts?.[kind] ? new Date(s.alerts[kind]).getTime() : 0;
  if (Date.now() - last < everyMin * 60_000) return;
  await writeIg({ ...s, alerts: { ...s.alerts, [kind]: new Date().toISOString() } });
  await notifyPhone(text);
}

// Several public answers can be given separated by "|"; one is picked at random so they don't all look the same.
function pick(options: string) {
  const list = options
    .split("|")
    .map((o) => o.trim())
    .filter(Boolean);
  return list[Math.floor(Math.random() * list.length)] ?? options;
}

async function setEvent(id: number, status: "sent" | "failed" | "skipped", note: string) {
  if (status === "failed") console.error("[instagram]", id, note);
  await execute("UPDATE ig_events SET status = ?, error = ?, next_try_at = NULL WHERE id = ?", [status, note.slice(0, 500), id]);
}

const setNote = (id: number, note: string) => execute("UPDATE ig_events SET error = ? WHERE id = ?", [note.slice(0, 500), id]);

export type IncomingMessage = {
  sender?: { id?: string };
  recipient?: { id?: string };
  message?: { mid?: string; text?: string; is_echo?: boolean; quick_reply?: { payload?: string } };
  postback?: { payload?: string };
};

type GatedRow = IgEvent & { ig_user_id: string; account_id: string; gate_tries: number };

/**
 * A DM to our account (Meta's "messages" webhook). Only used for follow-gated rules: when someone who was asked to
 * follow taps "followed" (or writes back), we ask Instagram whether they follow us now and send the link if so.
 * Every other DM is left alone and nothing is stored.
 */
export async function handleMessage(accountId: string, m: IncomingMessage) {
  const sender = m.sender?.id;
  if (!sender || m.message?.is_echo || sender === accountId) return;
  const s = await readIg();
  if (!s.token || (s.userId && accountId && accountId !== s.userId)) return;

  // which comment this is about: the button carries its row id; a typed answer is matched to the person
  const payload = m.message?.quick_reply?.payload ?? m.postback?.payload ?? "";
  const tapped = /^IGF:(\d+)$/.exec(payload);
  let ev: GatedRow | undefined;
  if (tapped) {
    [ev] = await query<GatedRow>("SELECT * FROM ig_events WHERE id = ? AND status = 'gated'", [Number(tapped[1])]);
  } else {
    // nothing waits for a follow at all: an ordinary DM, ignore it without any call to Meta
    const [{ n }] = await query<{ n: string }>("SELECT COUNT(*) AS n FROM ig_events WHERE status = 'gated' AND created_at > now() - interval '7 days'");
    if (!Number(n)) return;
    [ev] = await query<GatedRow>("SELECT * FROM ig_events WHERE status = 'gated' AND ig_user_id = ? ORDER BY id DESC LIMIT 1", [sender.slice(0, 40)]);
  }

  // The comment's user id and the messaging id are usually the same; when not, the @username decides.
  let profile: { username?: string; is_user_follow_business?: boolean } | null = null;
  const lookUp = async () => {
    profile ??= await graph<{ username?: string; is_user_follow_business?: boolean }>(`/${encodeURIComponent(sender)}?fields=username,is_user_follow_business`, {
      token: s.token!,
      host: s.host,
    }).catch(() => ({}));
    return profile;
  };
  if (!ev) {
    const { username } = await lookUp();
    if (!username) return;
    [ev] = await query<GatedRow>("SELECT * FROM ig_events WHERE status = 'gated' AND username = ? ORDER BY id DESC LIMIT 1", [username.slice(0, 100)]);
    if (!ev) return;
  } else if (!tapped && ev.ig_user_id !== sender) {
    // a tap carries the row id and only reaches the commenter's own DM, so it needs no extra identity check
    const { username } = await lookUp();
    if (!username || username !== ev.username) return;
  }
  if (Number(ev.gate_tries) >= MAX_GATE_TRIES) return;

  // claim it, so two quick taps never send the link twice
  const claim = await execute("UPDATE ig_events SET status = 'sending', claimed_at = now() WHERE id = ? AND status = 'gated'", [ev.id]);
  if (!claim.count) return;
  const [rule] = await query<IgRule>("SELECT * FROM ig_rules WHERE id = ?", [ev.rule_id]);
  if (!rule || !rule.active) return setEvent(ev.id, "failed", "Kural silindi ya da kapatıldı.");

  const who = ev.account_id || s.userId || "me";
  const sendDm = (message: object) =>
    graph<Record<string, unknown>>(`/${encodeURIComponent(who)}/messages`, {
      token: s.token!,
      host: s.host,
      method: "POST",
      body: JSON.stringify({ recipient: { id: sender }, message }),
    });

  const { is_user_follow_business: follows } = await lookUp();
  // If Instagram does not tell us, the person is given the benefit of the doubt rather than left without the link.
  const unknown = typeof follows !== "boolean";
  try {
    if (follows || unknown) {
      await sendDm({ text: rule.dm_text });
      await execute("UPDATE ig_events SET status = 'sent', ig_user_id = ?, error = ? WHERE id = ?", [
        sender.slice(0, 40),
        unknown ? "Takip durumu öğrenilemedi, link yine de gönderildi." : "Takip etti, link gönderildi.",
        ev.id,
      ]);
      await execute("UPDATE ig_rules SET sent_count = sent_count + 1 WHERE id = ?", [rule.id]);
    } else {
      await sendDm(gateMessage(NOT_YET_TEXT, ev.id)).catch(() => sendDm(gatePlain(NOT_YET_TEXT)));
      await execute("UPDATE ig_events SET status = 'gated', gate_tries = gate_tries + 1, error = ? WHERE id = ?", [
        `Henüz takip etmiyor (${Number(ev.gate_tries) + 1}. kontrol).`,
        ev.id,
      ]);
    }
  } catch (e) {
    // put it back so the next tap can try again
    await execute("UPDATE ig_events SET status = 'gated', error = ? WHERE id = ?", [`Takip sonrası mesaj gitmedi: ${(e as Error).message}`.slice(0, 500), ev.id]);
  }
}

export const listRules = () => query<IgRule>("SELECT * FROM ig_rules ORDER BY id DESC");
export const EVENTS_PER_PAGE = 10;
/** One page of the log, newest first; a page number past the end gives the last page. */
export async function listEvents(page = 1) {
  const [count] = await query<{ n: string }>("SELECT COUNT(*) AS n FROM ig_events");
  const total = Number(count?.n ?? 0);
  const pages = Math.max(1, Math.ceil(total / EVENTS_PER_PAGE));
  const at = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const rows = await query<IgEvent>("SELECT * FROM ig_events ORDER BY id DESC LIMIT ? OFFSET ?", [EVENTS_PER_PAGE, (at - 1) * EVENTS_PER_PAGE]);
  return { rows, page: at, pages, total };
}

/** Last hour's numbers for the panel: DMs and public answers against their caps, and what waits in the queue. */
export async function hourStats() {
  const [row] = await query<{ dms: string; replies: string; queued: string }>(
    `SELECT (SELECT COUNT(*) FROM ig_events WHERE sent_at > now() - interval '1 hour') AS dms,
            (SELECT COUNT(*) FROM ig_events WHERE replied = 1 AND sent_at > now() - interval '1 hour') AS replies,
            (SELECT COUNT(*) FROM ig_events WHERE status IN ('retry','sending')) AS queued`,
  );
  return { dms: Number(row?.dms ?? 0), replies: Number(row?.replies ?? 0), queued: Number(row?.queued ?? 0) };
}
