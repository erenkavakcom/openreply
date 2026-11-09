import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { execute, query } from "@/lib/db";

// One owner, one password: ADMIN_PASSWORD from the environment. The session cookie is signed with it, so changing
// the password signs everyone out.

const COOKIE = "panel_oturum";
const SESSION_DAYS = 7;
/** Wrong passwords allowed per address in WINDOW_MIN minutes. */
const MAX_TRIES = 8;
const WINDOW_MIN = 15;

export const passwordReady = () => (process.env.ADMIN_PASSWORD ?? "").length >= 10;

const sign = (issued: string) => createHmac("sha256", `panel:${process.env.ADMIN_PASSWORD}`).update(issued).digest("base64url");

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function isSignedIn() {
  if (!passwordReady()) return false;
  const value = (await cookies()).get(COOKIE)?.value ?? "";
  const [issued, sig] = value.split(".");
  if (!issued || !sig || !same(sig, sign(issued))) return false;
  return Date.now() - Number(issued) < SESSION_DAYS * 86_400_000;
}

export async function requireOwner() {
  if (!(await isSignedIn())) redirect("/giris");
}

async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim().slice(0, 64);
}

/** Checks the password (with a per-address limit) and starts a session. */
export async function signIn(password: string): Promise<string | null> {
  if (!passwordReady()) return "Önce ADMIN_PASSWORD ortam değişkenini en az 10 karakter olarak ayarla.";
  const ip = await clientIp();
  const [{ n }] = await query<{ n: string }>("SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > now() - make_interval(mins => ?)", [ip, WINDOW_MIN]);
  if (Number(n) >= MAX_TRIES) return `Çok fazla hatalı deneme. ${WINDOW_MIN} dakika sonra tekrar dene.`;
  if (!same(password, process.env.ADMIN_PASSWORD!)) {
    await execute("INSERT INTO login_attempts (ip) VALUES (?)", [ip]);
    await execute("DELETE FROM login_attempts WHERE at < now() - interval '1 day'");
    return "Şifre yanlış.";
  }
  const issued = String(Date.now());
  (await cookies()).set(COOKIE, `${issued}.${sign(issued)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  return null;
}

export async function signOut() {
  (await cookies()).delete(COOKIE);
}
