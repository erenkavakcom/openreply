"use server";

import { requireOwner, signIn, signOut } from "@/lib/auth";
import { execute, query } from "@/lib/db";
import { cleanToken, findMedia, processQueue, readIg, whoAmI, writeIg } from "@/lib/instagram";
import { redirect } from "next/navigation";

export type IgState = { ok: boolean; message: string };

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** Saves the pasted token (checked against Instagram first) and/or the app secret. Empty fields keep what is stored. */
export async function saveIgConnection(input: { token: string; appSecret: string; accountId?: string }): Promise<IgState> {
  await requireOwner();
  const s = await readIg();
  const accountId = str(input.accountId, 40);
  if (accountId && !/^\d+$/.test(accountId)) return { ok: false, message: "Hesap kimliği sadece rakamlardan oluşur." };
  const token = cleanToken(str(input.token, 2000));
  const appSecret = str(input.appSecret, 200);
  if (!token && !appSecret) return { ok: false, message: "Token ya da uygulama gizli anahtarını yaz." };
  if (appSecret && !/^[0-9a-f]{32}$/i.test(appSecret)) return { ok: false, message: "Gizli anahtar 32 karakterlik bir kod olmalı." };
  // the secret is kept even when the token below fails, so it need not be pasted again
  if (appSecret) {
    s.appSecret = appSecret;
    await writeIg(s);
  }
  if (token) {
    try {
      const me = await whoAmI(token, accountId || s.userId);
      Object.assign(s, {
        token,
        host: me.host,
        userId: me.userId,
        username: me.username,
        tokenSavedAt: new Date().toISOString(),
        // Instagram-login tokens from the Meta app's "Generate token" button last 60 days; system-user tokens never expire
        tokenExpiresAt: me.host === "instagram" ? new Date(Date.now() + 60 * 86_400_000).toISOString() : undefined,
      });
    } catch (e) {
      return {
        ok: false,
        message: `${appSecret ? "Gizli anahtar kaydedildi, ama token" : "Token"} çalışmadı (${token.length} karakter, "${token.slice(0, 4)}…" ile başlıyor): ${(e as Error).message}`,
      };
    }
  }
  if (appSecret) s.appSecret = appSecret;
  await writeIg(s);
  return {
    ok: true,
    message: token
      ? s.username
        ? `Bağlandı: @${s.username}`
        : "Token kaydedildi. Hesap adı ilk yorum geldiğinde görünecek."
      : "Gizli anahtar kaydedildi.",
  };
}

export async function disconnectIg(): Promise<IgState> {
  await requireOwner();
  const s = await readIg();
  await writeIg({ verifyToken: s.verifyToken, appSecret: s.appSecret });
  return { ok: true, message: "Instagram bağlantısı kaldırıldı." };
}

export async function saveIgRule(input: {
  id?: number;
  keywords: string;
  mediaId: string;
  dmText: string;
  replyText: string;
  active: boolean;
  followGate: boolean;
  gateText: string;
}): Promise<IgState> {
  await requireOwner();
  const keywords = str(input.keywords, 300);
  const dmText = str(input.dmText, 1000);
  const replyText = str(input.replyText, 500);
  const media = str(input.mediaId, 300);
  const gateText = str(input.gateText, 500);
  const id = input.id ? Math.trunc(Number(input.id)) : 0;
  if (!keywords) return { ok: false, message: "En az bir anahtar kelime yaz." };
  if (!dmText) return { ok: false, message: "DM metnini yaz." };

  // The post the rule is for: empty = every post; a video link is turned into that post's id; a bare id is kept.
  let mediaId = "";
  let mediaUrl = "";
  if (/^\d+$/.test(media)) mediaId = media.slice(0, 40);
  else if (media) {
    const [old] = id ? await query<{ media_id: string; media_url: string }>("SELECT media_id, media_url FROM ig_rules WHERE id = ?", [id]) : [];
    // the same link as before: no need to ask Instagram again
    if (old?.media_id && old.media_url === media) ({ media_id: mediaId, media_url: mediaUrl } = old);
    else {
      try {
        ({ id: mediaId, url: mediaUrl } = await findMedia(media));
      } catch (e) {
        return { ok: false, message: (e as Error).message };
      }
      mediaUrl = mediaUrl.slice(0, 300);
    }
  }

  const values = [keywords, mediaId, mediaUrl, dmText, replyText, input.active ? 1 : 0, input.followGate ? 1 : 0, gateText];
  if (id)
    await execute(
      "UPDATE ig_rules SET keywords = ?, media_id = ?, media_url = ?, dm_text = ?, reply_text = ?, active = ?, follow_gate = ?, gate_text = ? WHERE id = ?",
      [...values, id],
    );
  else
    await execute("INSERT INTO ig_rules (keywords, media_id, media_url, dm_text, reply_text, active, follow_gate, gate_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", values);
  const where = mediaId ? "Sadece seçtiğin videonun yorumlarında çalışır." : "Bütün gönderilerin yorumlarında çalışır.";
  return { ok: true, message: `${id ? "Kural güncellendi." : "Kural eklendi."} ${where}` };
}

export async function removeIgRule(id: number): Promise<IgState> {
  await requireOwner();
  await execute("DELETE FROM ig_rules WHERE id = ?", [Math.trunc(Number(id))]);
  return { ok: true, message: "Kural silindi." };
}

export async function login(_prev: string | null, form: FormData): Promise<string | null> {
  const error = await signIn(String(form.get("password") ?? ""));
  if (error) return error;
  redirect("/");
}

export async function logout() {
  await signOut();
  redirect("/giris");
}

/** "Sırayı şimdi gönder" in the panel: sends what waits in the queue right away. */
export async function flushQueue(): Promise<IgState> {
  await requireOwner();
  await processQueue(40);
  return { ok: true, message: "Sıradaki DM'ler gönderildi (Meta'nın saatlik sınırı içinde)." };
}
