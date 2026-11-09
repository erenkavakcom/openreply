import { Legal } from "@/components/legal";
import { siteUrl } from "@/lib/site-url";

export const metadata = { title: "Gizlilik politikası" };

export default async function PrivacyPage() {
  const url = await siteUrl();
  return (
    <Legal title="Gizlilik politikası">
      <p>
        Bu hizmet, Instagram hesabının sahibinin gönderilerine belirli bir kelimeyle yorum yapan kişilere otomatik olarak doğrudan mesaj (DM)
        göndermek için kullanılır. Hizmet {url} adresinde, hesap sahibi tarafından kendi hesabı için çalıştırılır.
      </p>
      <h2>Hangi bilgiler işlenir?</h2>
      <p>
        Bir yorum, tanımlı bir anahtar kelimeyle eşleştiğinde yalnızca şu bilgiler kaydedilir: yorumun kimliği ve metni, yorum yapan kişinin
        Instagram kullanıcı adı ve kimliği, gönderinin kimliği, mesajın gönderilip gönderilmediği ve zamanı. Eşleşmeyen yorumlar ve diğer
        mesajlar kaydedilmez.
      </p>
      <h2>Ne için kullanılır?</h2>
      <p>
        Bu bilgiler yalnızca istenen mesajı göndermek, aynı kişiye aynı mesajın birden fazla gitmesini önlemek ve gönderim sorunlarını görmek için
        kullanılır. Hiçbir bilgi satılmaz, reklam için kullanılmaz ve üçüncü kişilerle paylaşılmaz; mesajlar Meta&apos;nın (Instagram) resmi
        arayüzü üzerinden gönderilir.
      </p>
      <h2>Ne kadar saklanır?</h2>
      <p>Kayıtlar en fazla 90 gün saklanır ve bu sürenin sonunda kendiliğinden silinir.</p>
      <h2>Verilerimi nasıl sildiririm?</h2>
      <p>
        Kayıtlarının silinmesini istersen <a className="underline" href={`${url}/veri-silme`}>veri silme</a> sayfasındaki adımları izle.
      </p>
    </Legal>
  );
}
