import Link from "next/link";
import { Brand } from "@/components/brand";

/** Shared frame for the public privacy and data-deletion pages Meta asks for. */
export function Legal({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-[760px] px-4 pt-12 sm:px-6">
      <Link href="/" className="inline-block">
        <Brand />
      </Link>
      <h1 className="mt-8 font-display text-3xl font-extrabold tracking-tight">{title}</h1>
      <div className="mt-6 grid gap-4 leading-relaxed text-white/85 [&_h2]:mt-4 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-extrabold [&_h2]:text-white">
        {children}
      </div>
    </main>
  );
}
