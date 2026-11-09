import { Legal } from "@/components/legal";

export const metadata = { title: "Veri silme" };

export default function DeletionPage() {
  return (
    <Legal title="Verilerin silinmesi">
      <p>
        Bu hizmet yalnızca anahtar kelimeyle eşleşen yorumlar için kısa bir kayıt tutar (yorumun metni, kullanıcı adı, mesajın gönderilip
        gönderilmediği) ve bu kayıtları en fazla 90 gün sonra kendiliğinden siler.
      </p>
      <p>
        Kayıtlarının daha önce silinmesini istersen, yorum yaptığın Instagram hesabına DM ile &quot;verilerimi sil&quot; yazman yeterli. Hesap
        sahibi, isteğini aldıktan sonra en geç 30 gün içinde seninle ilgili tüm kayıtları siler.
      </p>
      <p>Instagram&apos;daki yorumların ve mesajların kendisi Instagram&apos;da kalır; onları Instagram uygulamasından silebilirsin.</p>
    </Legal>
  );
}
