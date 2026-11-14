"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Check, Copy, ListChecks, LogOut, MessageCircle, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { disconnectIg, flushQueue, logout, removeIgRule, saveIgConnection, saveIgRule } from "@/app/actions";
import { Brand } from "@/components/brand";
import { btnGhost, btnPrimary, card, hint, input, label } from "@/lib/ui";

export type Connection = {
  connected: boolean;
  username: string;
  daysLeft: number | null;
  hasSecret: boolean;
  verifyToken: string;
  siteUrl: string;
  /** a matching comment has reached the webhook at least once, so Meta is wired up */
  webhookSeen: boolean;
};
export type Rule = {
  id: number;
  keywords: string;
  media_id: string;
  media_url: string;
  dm_text: string;
  reply_text: string;
  active: boolean;
  sent_count: number;
  follow_gate: boolean;
  gate_text: string;
};
export type Event = { id: number; username: string; comment_text: string; status: string; error: string; created_at: string };
export type Stats = { dms: number; replies: number; queued: number; dmCap: number; replyCap: number };
type Draft = { id?: number; keywords: string; mediaId: string; dmText: string; replyText: string; active: boolean; followGate: boolean; gateText: string };
type Tab = "rehber" | "kurallar" | "gonderimler";

const EMPTY: Draft = { keywords: "", mediaId: "", dmText: "", replyText: "", active: true, followGate: false, gateText: "" };
/** "instagram.com/reel/Dabc…/" → "reel/Dabc…", short enough for the rule's line */
const shortLink = (url: string) => url.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/+$/, "");
const logHref = (page: number) => (page > 1 ? `/?sayfa=${page}` : "/");
const when = (iso: string) => new Date(iso).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });

const STATUS: Record<string, { label: string; cls: string }> = {
  sent: { label: "Gönderildi", cls: "bg-emerald-400/15 text-emerald-300" },
  retry: { label: "Kuyrukta", cls: "bg-amber-400/15 text-amber-300" },
  gated: { label: "Takip bekleniyor", cls: "bg-violet-400/15 text-violet-300" },
  sending: { label: "Gönderiliyor", cls: "bg-sky-400/15 text-sky-300" },
  skipped: { label: "Atlandı", cls: "bg-white/8 text-mist" },
  failed: { label: "Hata", cls: "bg-brand/20 text-[#ff9b85]" },
};

function CopyField({ name, value, note }: { name: string; value: string; note?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div>
      <span className={label}>{name}</span>
      {note && <span className={hint}>{note}</span>}
      <div className="flex gap-2">
        <input readOnly value={value} className={`${input} font-mono text-[13px]`} onFocus={(e) => e.target.select()} />
        <button
          type="button"
          className={btnGhost}
          aria-label={`${name} kopyala`}
          onClick={() =>
            navigator.clipboard.writeText(value).then(() => {
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            })
          }
        >
          {done ? <Check className="size-4" /> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <li className={card}>
      <div className="flex items-start gap-3">
        <span
          className={`grid size-8 shrink-0 place-items-center rounded-full font-display text-sm font-black ${done ? "bg-emerald-400 text-navy" : "bg-brand text-white"}`}
        >
          {done ? <Check className="size-4" /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-extrabold leading-8">{title}</h3>
          <div className="mt-2 grid gap-3 text-[15px] leading-relaxed text-white/85 [&_b]:text-white [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[13px]">
            {children}
          </div>
        </div>
      </div>
    </li>
  );
}

export function Panel({
  connection,
  rules,
  events,
  log,
  stats,
  defaultGateText,
}: {
  connection: Connection;
  rules: Rule[];
  /** one page of the log (ten rows), newest first */
  events: Event[];
  log: { page: number; pages: number; total: number };
  stats: Stats;
  defaultGateText: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [token, setToken] = useState("");
  const [secret, setSecret] = useState("");
  const [accountId, setAccountId] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const ready = connection.connected && connection.hasSecret;
  const [tab, setTab] = useState<Tab>(log.page > 1 ? "gonderimler" : ready ? "kurallar" : "rehber");

  const run = (fn: () => Promise<{ ok: boolean; message: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "rehber", label: "Kurulum rehberi", icon: <BookOpen className="size-4" /> },
    { id: "kurallar", label: "Kurallar", icon: <ListChecks className="size-4" /> },
    { id: "gonderimler", label: "Gönderimler", icon: <MessageCircle className="size-4" /> },
  ];

  return (
    <main className="mx-auto max-w-[1000px] px-4 pt-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Brand />
        <div className="flex items-center gap-2 text-xs">
          <span className={`rounded-full px-3 py-1.5 font-medium ${ready ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-400/15 text-amber-300"}`}>
            {ready
              ? `${connection.username ? `@${connection.username}` : "Instagram"} bağlı · ${connection.daysLeft === null ? "süresiz" : `token ${connection.daysLeft} gün geçerli`}`
              : "Kurulum bitmedi"}
          </span>
          <form action={logout}>
            <button type="submit" className="grid size-8 place-items-center rounded-full text-mist hover:bg-white/8 hover:text-white" aria-label="Çıkış yap">
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </header>

      <h1 className="mt-8 font-display text-3xl font-black tracking-tight sm:text-4xl">
        Yorum yapana <span className="text-brand">otomatik DM</span>
      </h1>
      <p className="mt-2 max-w-[640px] text-mist">
        Gönderine anahtar kelimeyle yorum yapan kişiye Instagram&apos;dan otomatik mesaj gider. İstersen yalnızca seni takip edenlere.
      </p>

      <nav className="mt-6 flex gap-1 overflow-x-auto rounded-full bg-navy-1 p-1 ring-1 ring-white/8 [scrollbar-width:none]" aria-label="Bölümler">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id ? "bg-brand text-white" : "text-mist hover:text-white"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>

      {message && (
        <p
          role="status"
          className={`mt-6 rounded-xl px-4 py-3 text-sm ring-1 ${message.ok ? "bg-emerald-400/10 text-emerald-200 ring-emerald-400/30" : "bg-brand/15 text-white ring-brand/40"}`}
        >
          {message.text}
        </p>
      )}

      {tab === "rehber" && (
        <ol className="mt-6 grid gap-4">
          <Step n={1} title="Instagram hesabını profesyonel yap">
            <p>
              Instagram uygulamasında <b>Ayarlar → Hesap türü ve araçlar → Profesyonel hesaba geç</b>. &quot;İşletme&quot; ya da &quot;İçerik
              üreticisi&quot; seçebilirsin. Kişisel hesaplarda otomatik DM çalışmaz.
            </p>
            <p>
              Aynı yerde <b>Ayarlar → Mesajlar ve hikaye yanıtları → Mesaj kontrolleri → Bağlı araçlar</b> bölümünde{" "}
              <b>&quot;Mesajlara erişime izin ver&quot;</b> seçeneğini aç. Kapalıysa mesajlar gitmez.
            </p>
          </Step>

          <Step n={2} title="Meta'da uygulama oluştur">
            <p>
              <a className="font-medium text-white underline decoration-brand decoration-2" href="https://developers.facebook.com/apps/" target="_blank" rel="noopener">
                developers.facebook.com/apps
              </a>{" "}
              adresine Facebook hesabınla gir (ilk kez giriyorsan &quot;Get started&quot; ile geliştirici hesabını aç).
            </p>
            <p>
              <b>Uygulama oluştur</b> → bir ad ver (örn. &quot;Yorum DM&quot;) → kullanım durumu olarak <b>&quot;Instagram&apos;da mesajları ve içeriği
              yönet&quot;</b> (Manage messaging &amp; content on Instagram) seç → işletme portföyünü atlayabilirsin → <b>Oluştur</b>.
            </p>
          </Step>

          <Step n={3} title="Token'ı al ve buraya yapıştır" done={connection.connected}>
            <p>
              Uygulamada <b>Kullanım durumları → Instagram API → Özelleştir → &quot;API setup with Instagram login&quot;</b> sekmesine gir.
            </p>
            <p>
              <b>1. Generate access tokens</b> bölümünde <b>Add account</b> ile kendi Instagram hesabına giriş yap ve izinleri onayla. Hesabın
              yanında çıkan <b>Generate token</b> düğmesine bas, çıkan uzun kodu (<code>IGAA…</code> ile başlar) kopyala. Hesap adının altındaki
              numara da hesap kimliğin.
            </p>
            <p>
              Aynı sayfada <b>&quot;Instagram app secret&quot;</b> yazan yerde <b>Göster</b>&apos;e bas ve 32 karakterlik gizli anahtarı kopyala.
            </p>
            <form
              className="mt-1 grid gap-4 rounded-2xl bg-navy p-4 ring-1 ring-white/8"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => saveIgConnection({ token, appSecret: secret, accountId }), () => {
                  setToken("");
                  setSecret("");
                  setAccountId("");
                });
              }}
            >
              <label>
                <span className={label}>
                  Access token {connection.connected && <span className="text-mist">(kayıtlı; yenisini yapıştırırsan eskisinin yerine geçer)</span>}
                </span>
                <textarea value={token} onChange={(e) => setToken(e.target.value)} rows={3} className={`${input} font-mono text-[13px]`} placeholder="IGAA…" autoComplete="off" />
              </label>
              <label>
                <span className={label}>Instagram hesap kimliği (isteğe bağlı)</span>
                <input value={accountId} onChange={(e) => setAccountId(e.target.value)} inputMode="numeric" className={`${input} font-mono text-[13px]`} placeholder="1784…" />
              </label>
              <label>
                <span className={label}>Instagram app secret {connection.hasSecret && <span className="text-mist">(kayıtlı; değiştirmek için yaz)</span>}</span>
                <input value={secret} onChange={(e) => setSecret(e.target.value)} type="password" className={`${input} font-mono text-[13px]`} autoComplete="off" />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={pending} className={btnPrimary}>
                  Kaydet ve kontrol et
                </button>
                {connection.connected && (
                  <button type="button" disabled={pending} className={btnGhost} onClick={() => confirm("Instagram bağlantısı kaldırılsın mı? DM'ler durur.") && run(disconnectIg)}>
                    Bağlantıyı kaldır
                  </button>
                )}
              </div>
            </form>
            <p className="text-sm text-mist">Token 60 gün geçerlidir; sistem süresi dolmadan kendisi yeniler.</p>
          </Step>

          <Step n={4} title="Webhook'u bağla" done={connection.webhookSeen}>
            <p>
              Aynı sayfada <b>2. Configure webhooks</b> bölümüne şu iki değeri yapıştır ve <b>Verify and save</b>&apos;e bas:
            </p>
            <CopyField name="Callback URL" value={`${connection.siteUrl}/api/instagram/webhook`} />
            <CopyField name="Verify token" value={connection.verifyToken} />
            <p>
              Kaydettikten sonra altta çıkan listede <b>comments</b> ve <b>messages</b> satırlarındaki <b>Subscribe</b> düğmelerini aç. Webhook
              hesabının yanındaki anahtar da açık olmalı.
            </p>
          </Step>

          <Step n={5} title="Gizlilik sayfalarını ekle ve uygulamayı yayına al">
            <p>
              Meta, uygulamayı yayına almak için gizlilik politikası ister. Bu sistem onları hazır getiriyor. <b>Uygulama ayarları → Temel</b>{" "}
              sayfasında şunları yapıştır, bir uygulama simgesi ve kategori seç, <b>Kaydet</b>&apos;e bas:
            </p>
            <CopyField name="Gizlilik politikası URL'si" value={`${connection.siteUrl}/gizlilik`} />
            <CopyField name="Kullanıcı verisi silme URL'si" value={`${connection.siteUrl}/veri-silme`} />
            <p>
              Sonra sol menüde <b>Yayınla</b> (Publish) bölümünden uygulamayı <b>Live</b> moda al. Geliştirme modunda yalnızca uygulamada rolü olan
              kişilerin yorumları gelir.
            </p>
            <p className="text-sm text-mist">
              Kendi hesabın için kullandığın sürece Meta incelemesine (App Review) gerek yoktur; izinler &quot;standart erişim&quot;le çalışır.
            </p>
          </Step>

          <Step n={6} title="Kural ekle ve dene" done={rules.length > 0 && connection.webhookSeen}>
            <p>
              <b>Kurallar</b> sekmesinden ilk kuralını ekle: örneğin &quot;link&quot; yazana rehberinin adresini gönder.
            </p>
            <p>
              Sonra <b>başka bir Instagram hesabından</b> gönderine o kelimeyle yorum yaz. Kendi yorumların bilerek yok sayılır. Birkaç saniye
              içinde DM gelmeli; olanlar <b>Gönderimler</b> sekmesinde görünür.
            </p>
            <div>
              <button type="button" className={btnPrimary} onClick={() => setTab("kurallar")}>
                Kurallara geç
              </button>
            </div>
          </Step>

          <li className={card}>
            <h3 className="font-display text-lg font-extrabold">Sık karşılaşılan sorunlar</h3>
            <ul className="mt-3 grid gap-2.5 text-[15px] leading-relaxed text-white/85">
              <li>
                <b className="text-white">Webhook &quot;doğrulanamadı&quot; diyor:</b> Callback URL ve Verify token&apos;ı bu sayfadan aynen kopyaladığından,
                sitenin yayında olduğundan emin ol.
              </li>
              <li>
                <b className="text-white">Yorum geliyor ama DM gitmiyor:</b> Instagram&apos;da &quot;Mesajlara erişime izin ver&quot; açık mı (1. adım),
                uygulama Live modda mı (5. adım)? Gönderimler sekmesindeki hata yazısı nedenini söyler.
              </li>
              <li>
                <b className="text-white">Hiçbir şey olmuyor:</b> kendi hesabınla yorum yapıyorsan yok sayılır; başka bir hesaptan dene. Webhook&apos;ta
                comments aboneliği açık olmalı.
              </li>
              <li>
                <b className="text-white">&quot;Token geçersiz&quot;:</b> 3. adımdan yeni token üretip yapıştır.
              </li>
              <li>
                <b className="text-white">Çok yorum geldi, bazıları bekliyor:</b> Meta saatte yaklaşık 750 DM&apos;ye izin veriyor; sistem 600&apos;de durur,
                gerisini sıraya alır ve sırayla gönderir.
              </li>
            </ul>
          </li>
        </ol>
      )}

      {tab === "kurallar" && (
        <section className={`${card} mt-6`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl font-extrabold">Kurallar</h2>
            {!draft && (
              <button type="button" className={btnPrimary} onClick={() => setDraft(EMPTY)}>
                <Plus className="size-4" /> Yeni kural
              </button>
            )}
          </div>
          {!ready && (
            <p className="mt-3 rounded-xl bg-amber-400/10 px-3.5 py-2.5 text-sm text-amber-200 ring-1 ring-amber-400/30">
              Kurallar kaydedilir ama DM&apos;ler, Kurulum rehberindeki adımlar bitince gitmeye başlar.
            </p>
          )}

          {draft && (
            <form
              className="mt-5 grid gap-4 rounded-2xl bg-navy p-4 ring-1 ring-white/8 sm:p-5"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => saveIgRule(draft), () => setDraft(null));
              }}
            >
              <label>
                <span className={label}>Anahtar kelimeler</span>
                <span className={hint}>Virgülle ayır. &quot;link&quot; yazınca &quot;linki, linkini&quot; de yakalanır; uzun kelimelerde bir harf hatası tolere edilir.</span>
                <input value={draft.keywords} onChange={(e) => setDraft({ ...draft, keywords: e.target.value })} className={input} placeholder="link, rehber" />
              </label>
              <label>
                <span className={label}>Gönderilecek DM</span>
                <textarea value={draft.dmText} onChange={(e) => setDraft({ ...draft, dmText: e.target.value })} rows={4} className={input} placeholder="Selam! İstediğin rehber burada: https://..." />
              </label>
              <label>
                <span className={label}>Yorumun altına herkese açık yanıt</span>
                <span className={hint}>Boşsa &quot;DM&apos;den gönderdim 🙌&quot; gibi yanıtlardan biri gider. Birkaç seçeneği | ile ayır.</span>
                <input value={draft.replyText} onChange={(e) => setDraft({ ...draft, replyText: e.target.value })} className={input} placeholder="DM'ine gönderdim 🙌 | Mesajlarına bak 📩" />
              </label>
              <label>
                <span className={label}>Video linki (isteğe bağlı)</span>
                <span className={hint}>
                  Instagram&apos;daki videonun linkini yapıştır; kural sadece o videonun yorumlarında çalışır. Boşsa tüm gönderilerde çalışır. Aynı kelimeyle
                  linksiz bir kural da varsa, bu videoda linkli olan gider.
                </span>
                <input
                  value={draft.mediaId}
                  onChange={(e) => setDraft({ ...draft, mediaId: e.target.value })}
                  className={`${input} font-mono text-[13px]`}
                  inputMode="url"
                  placeholder="https://www.instagram.com/reel/…"
                />
              </label>
              <div className="rounded-xl bg-navy-1 p-3.5 ring-1 ring-white/8">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={draft.followGate} onChange={(e) => setDraft({ ...draft, followGate: e.target.checked })} className="mt-0.5 size-4 accent-[#d62a0d]" />
                  <span>
                    <b>Sadece takip edenlere gönder</b>
                    <span className="block text-xs text-mist">Önce &quot;takip et&quot; mesajı ve &quot;Takip ettim ✅&quot; butonu gider; butona dokununca takip ediyorsa link gönderilir.</span>
                  </span>
                </label>
                {draft.followGate && (
                  <label className="mt-3 block">
                    <span className={label}>&quot;Takip et&quot; mesajı (boşsa varsayılan)</span>
                    <textarea value={draft.gateText} onChange={(e) => setDraft({ ...draft, gateText: e.target.value })} rows={2} className={input} placeholder={defaultGateText} />
                  </label>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} className="size-4 accent-[#d62a0d]" />
                Açık
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={pending} className={btnPrimary}>
                  {draft.id ? "Güncelle" : "Ekle"}
                </button>
                <button type="button" className={btnGhost} onClick={() => setDraft(null)}>
                  Vazgeç
                </button>
              </div>
            </form>
          )}

          {rules.length === 0 && !draft ? (
            <p className="mt-4 text-sm text-mist">Henüz kural yok. İlk kuralı ekle: örneğin &quot;link&quot; yazana rehberinin adresini gönder.</p>
          ) : (
            <ul className="mt-5 grid gap-3">
              {rules.map((r) => (
                <li key={r.id} className={`rounded-2xl bg-navy p-4 ring-1 ring-white/8 ${r.active ? "" : "opacity-55"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap gap-1.5">
                        {r.keywords
                          .split(",")
                          .map((k) => k.trim())
                          .filter(Boolean)
                          .map((k) => (
                            <span key={k} className="rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-white">
                              {k}
                            </span>
                          ))}
                      </div>
                      <p className="mt-2 whitespace-pre-line break-words text-sm">{r.dm_text}</p>
                      <p className="mt-2 text-xs text-mist">
                        {r.media_url ? (
                          <>
                            Sadece{" "}
                            <a href={r.media_url} target="_blank" rel="noopener noreferrer" className="font-mono underline underline-offset-2 hover:text-white">
                              {shortLink(r.media_url)}
                            </a>
                          </>
                        ) : r.media_id ? (
                          `Sadece gönderi ${r.media_id}`
                        ) : (
                          "Tüm gönderiler"
                        )}{" "}
                        · {r.sent_count} DM gönderildi
                        {r.follow_gate ? " · sadece takip edenlere" : ""}
                        {r.active ? "" : " · kapalı"}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        aria-label="Düzenle"
                        className="grid size-9 place-items-center rounded-full text-mist hover:bg-white/8 hover:text-white"
                        onClick={() =>
                          setDraft({
                            id: r.id,
                            keywords: r.keywords,
                            mediaId: r.media_url || r.media_id,
                            dmText: r.dm_text,
                            replyText: r.reply_text,
                            active: r.active,
                            followGate: r.follow_gate,
                            gateText: r.gate_text,
                          })
                        }
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Sil"
                        disabled={pending}
                        className="grid size-9 place-items-center rounded-full text-[#ff9b85] hover:bg-brand/20"
                        onClick={() => confirm("Bu kural silinsin mi?") && run(() => removeIgRule(r.id))}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "gonderimler" && (
        <section className={`${card} mt-6`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl font-extrabold">
              Son gönderimler {log.total > 0 && <span className="ml-1 text-xs font-normal text-mist tabular-nums">{log.total} kayıt</span>}
            </h2>
            {stats.queued > 0 && (
              <button type="button" disabled={pending} className={btnGhost} onClick={() => run(flushQueue)}>
                <Send className="size-4" /> Sırayı şimdi gönder
              </button>
            )}
          </div>
          <p className="mt-1 text-sm text-mist">
            Son 1 saat: {stats.dms}/{stats.dmCap} DM · {stats.replies}/{stats.replyCap} yorum yanıtı
            {stats.queued ? ` · ${stats.queued} kuyrukta` : ""}. Sınırı aşanlar kuyrukta bekler ve sırayla gönderilir; aynı kişiye aynı kural için tek
            DM gider.
          </p>
          {events.length === 0 ? (
            <p className="mt-4 text-sm text-mist">Henüz eşleşen yorum gelmedi.</p>
          ) : (
            <ul className="mt-4 divide-y divide-white/8 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${(STATUS[e.status] ?? STATUS.sending).cls}`}>{(STATUS[e.status] ?? STATUS.sending).label}</span>
                  <span className="font-medium">@{e.username || "?"}</span>
                  <span className="min-w-0 flex-1 truncate text-mist">{e.comment_text}</span>
                  <span className="text-xs text-mist">{when(e.created_at)}</span>
                  {e.error && <span className={`w-full break-words text-xs ${e.status === "failed" ? "text-[#ff9b85]" : "text-mist"}`}>{e.error}</span>}
                </li>
              ))}
            </ul>
          )}
          {log.pages > 1 && (
            <nav aria-label="Günlük sayfaları" className="mt-4 flex items-center justify-center gap-3 text-sm">
              {log.page > 1 && (
                <Link href={logHref(log.page - 1)} scroll={false} className={btnGhost}>
                  Önceki
                </Link>
              )}
              <span className="text-mist tabular-nums">
                {log.page} / {log.pages}
              </span>
              {log.page < log.pages && (
                <Link href={logHref(log.page + 1)} scroll={false} className={btnGhost}>
                  Sonraki
                </Link>
              )}
            </nav>
          )}
        </section>
      )}
    </main>
  );
}
