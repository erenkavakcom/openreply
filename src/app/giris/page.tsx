import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Brand } from "@/components/brand";
import { hasDatabase } from "@/lib/db";
import { isSignedIn, passwordReady } from "@/lib/auth";
import { card } from "@/lib/ui";
import { LoginForm } from "./login-form";

export const metadata = { title: "Giriş" };

export default async function LoginPage() {
  await connection();
  if (passwordReady() && hasDatabase() && (await isSignedIn())) redirect("/");
  const missing = [!hasDatabase() && "DATABASE_URL (Postgres veritabanı)", !passwordReady() && "ADMIN_PASSWORD (en az 10 karakter)"].filter(Boolean);
  return (
    <main className="mx-auto grid max-w-[420px] px-4 pt-20">
      <Brand />
      <div className={`${card} mt-6`}>
        <h1 className="font-display text-2xl font-extrabold">Panele giriş</h1>
        {missing.length ? (
          <div className="mt-4 text-sm text-mist">
            <p className="text-white">Kurulum neredeyse bitti. Barındırma panelinde şu ortam değişkenlerini ekle, sonra yeniden dağıt:</p>
            <ul className="mt-3 list-disc pl-5">
              {missing.map((m) => (
                <li key={String(m)}>{m}</li>
              ))}
            </ul>
            <p className="mt-3">Vercel&apos;de: Project → Settings → Environment Variables. Veritabanı için Storage → Neon (ücretsiz).</p>
          </div>
        ) : (
          <LoginForm />
        )}
      </div>
    </main>
  );
}
