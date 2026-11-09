import type { Metadata } from "next";
import { Jost, Nunito } from "next/font/google";
import { Footer } from "@/components/footer";
import "./globals.css";

const jost = Jost({ subsets: ["latin", "latin-ext"], variable: "--font-jost" });
const nunito = Nunito({ subsets: ["latin", "latin-ext"], weight: ["700", "800", "900"], variable: "--font-nunito" });

export const metadata: Metadata = {
  title: { default: "OpenReply", template: "%s · OpenReply" },
  description: "OpenReply: Instagram'da anahtar kelimeyle yorum yapanlara otomatik DM. Ücretsiz ve açık kaynak, erenkavak.com",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={`${jost.variable} ${nunito.variable}`}>
      <body className="flex min-h-dvh flex-col font-sans antialiased">
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
