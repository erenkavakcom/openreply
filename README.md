# Yorum → DM

**Instagram'da gönderine belirli bir kelimeyle yorum yapan herkese otomatik DM gönderen, ücretsiz ve açık kaynak sistem.**
ManyChat'in "yoruma LİNK yaz, DM'den göndereyim" özelliğinin, kendi hesabında aylık ücret ödemeden çalışan hali.

[![Vercel'e kur](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ferenkavakcom%2Finstagram-yorum-dm&project-name=instagram-yorum-dm&repository-name=instagram-yorum-dm&env=ADMIN_PASSWORD,CRON_SECRET&envDescription=ADMIN_PASSWORD%3A%20panel%20%C5%9Fifren%20(en%20az%2010%20karakter).%20CRON_SECRET%3A%20rastgele%20uzun%20bir%20kelime.&envLink=https%3A%2F%2Fgithub.com%2Ferenkavakcom%2Finstagram-yorum-dm%23kurulum)

> [erenkavak.com](https://erenkavak.com) tarafından yapıldı. Destek olmak istersen
> [Instagram](https://www.instagram.com/erenkavakcom/), [YouTube](https://www.youtube.com/@erenkavakcom) ve
> [TikTok](https://www.tiktok.com/@erenkavakcom)'ta **@erenkavakcom**'u takip et.

## Neler yapar?

- **Anahtar kelimeyle yorum → otomatik DM.** "link", "rehber" gibi kelimeler; Türkçe ekleri ("linki", "rehberini") ve uzun kelimelerde bir harf hatasını da yakalar.
- **Sadece takip edenlere** seçeneği: önce "takip et" mesajı ve **Takip ettim ✅** butonu gider, takip ettiyse link gönderilir.
- **Yorumun altına otomatik yanıt** ("DM'den gönderdim 🙌"), birkaç seçenek arasından rastgele.
- **Aynı kişiye tek DM**: üç kez yorum yazan bir kez mesaj alır.
- **Viral gönderiye hazır**: Meta'nın saatlik sınırına takılmadan saatte 600 DM gönderir, fazlasını sıraya alıp sırayla yollar; hata olursa kendisi tekrar dener.
- **Gönderi bazında kural**: bir kural tüm gönderilerde ya da yalnızca seçtiğin gönderide çalışır.
- **Panel**: kurallar, son gönderimler, hata nedenleri, uygulamanın içinde adım adım kurulum rehberi.
- İsteğe bağlı **Telegram uyarısı**: token geçersiz olursa ya da gönderimler takılırsa haber verir.

Kendi hesabın için kullandığın sürece Meta incelemesine (App Review) gerek yoktur.

## Kurulum

Toplam yaklaşık 15-20 dakika. İki bölümü var: siteyi kurmak (5 dk) ve Meta'yı bağlamak (10-15 dk).

### 1. Siteyi kur (Vercel, ücretsiz)

1. Yukarıdaki **Vercel'e kur** butonuna bas, GitHub hesabınla giriş yap.
2. İki değer sorulacak:
   - `ADMIN_PASSWORD`: panelin şifresi. En az 10 karakter, tahmin edilmesi zor bir şey.
   - `CRON_SECRET`: rastgele uzun bir kelime (örn. `k8Fq2mZ7xLw9Pn4R`). Sıradaki DM'leri gönderen zamanlayıcı için.
3. **Deploy**'a bas. Kurulum 1-2 dakika sürer.
4. Veritabanını ekle: Vercel'de projene gir → **Storage** → **Create Database** → **Neon** (ücretsiz plan) → **Connect**.
   Bu, `DATABASE_URL`'i kendiliğinden ekler.
5. **Deployments** sekmesinde son kurulumun yanındaki **⋯ → Redeploy** ile bir kez yeniden kur.
6. Sitenin adresini aç (örn. `https://instagram-yorum-dm-xxxx.vercel.app`), şifrenle giriş yap.

### 2. Meta'yı bağla

Panelde **Kurulum rehberi** sekmesi seni adım adım götürür. Kopyalaman gereken değerler (webhook adresi, doğrulama kodu,
gizlilik sayfası) orada hazır, yapıştırman gerekenler (token, gizli anahtar) için alanlar da aynı adımlarda. Özetle:

1. Instagram hesabını **profesyonel** yap; *Ayarlar → Mesajlar ve hikaye yanıtları → Mesaj kontrolleri → Bağlı araçlar* bölümünde
   **Mesajlara erişime izin ver**'i aç.
2. [developers.facebook.com/apps](https://developers.facebook.com/apps/) → **Uygulama oluştur** → kullanım durumu:
   **Instagram'da mesajları ve içeriği yönet**.
3. *Instagram API → API setup with Instagram login* → **Generate token** ile token'ı al; **Instagram app secret**'ı kopyala;
   ikisini panele yapıştır.
4. Aynı sayfada **Configure webhooks**: panelden Callback URL ve Verify token'ı yapıştır → **comments** ve **messages**'a abone ol.
5. *Uygulama ayarları → Temel*: gizlilik ve veri silme adreslerini (panelde hazır) yapıştır → uygulamayı **Live** moda al.
6. Panelde kural ekle, **başka bir hesaptan** yorum yazıp dene.

## Başka bir sunucuda çalıştırmak

Node.js 20.9+ olan her yerde çalışır (Hostinger, bir VPS, kendi bilgisayarın). Bir Postgres veritabanı gerekir
(Neon, Supabase gibi ücretsiz servisler olur).

```bash
git clone https://github.com/erenkavakcom/instagram-yorum-dm.git
cd instagram-yorum-dm
npm install
cp .env.example .env   # DATABASE_URL ve ADMIN_PASSWORD'ü doldur
npm run build
npm start
```

Normal bir sunucuda sıradaki DM'ler iki dakikada bir kendiliğinden gönderilir. Meta webhook'a HTTPS adres ister.

## Ortam değişkenleri

| Değişken | Gerekli | Ne işe yarar |
|---|---|---|
| `DATABASE_URL` | Evet | Postgres adresi (Vercel'de Neon eklenince kendiliğinden gelir) |
| `ADMIN_PASSWORD` | Evet | Panel şifresi, en az 10 karakter |
| `CRON_SECRET` | Önerilir | `/api/cron` zamanlayıcısının anahtarı |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Hayır | Sorun olunca Telegram'dan haber almak için |

## Sık sorulanlar

**Vercel'de sıradaki DM'ler ne zaman gider?** Saatlik sınırı aşan yorumlar sıraya girer. Vercel'in ücretsiz planı zamanlayıcıyı günde
bir kez çalıştırır; ama her yeni yorum ve paneli her açışın da sırayı gönderir. Çok viral bir gönderi bekliyorsan
[cron-job.org](https://cron-job.org) gibi ücretsiz bir servisle `https://SİTEN/api/cron?key=CRON_SECRET` adresini 5 dakikada bir çağırabilirsin.

**Kişisel hesapta çalışır mı?** Hayır, Instagram yalnızca profesyonel (İşletme ya da İçerik üreticisi) hesaplara bu izni veriyor.

**Token'ın süresi dolarsa?** Token 60 gün geçerli; sistem dolmadan kendisi yeniler. Yenileyemezse panelde ve (kuruluysa) Telegram'da uyarı görürsün.

**Verileri ne kadar saklanıyor?** Yalnızca eşleşen yorumların kısa kaydı, en fazla 90 gün. Ayrıntısı sitendeki `/gizlilik` sayfasında.

## Lisans

[MIT](LICENSE). Ücretsiz kullanabilir, değiştirebilir ve dağıtabilirsin.

---

**Bu sistemi [Eren Kavak](https://erenkavak.com) yaptı.** Ücretsiz kalmasına destek olmak istersen takip et:
[Instagram](https://www.instagram.com/erenkavakcom/) · [YouTube](https://www.youtube.com/@erenkavakcom) · [TikTok](https://www.tiktok.com/@erenkavakcom) — **@erenkavakcom**
