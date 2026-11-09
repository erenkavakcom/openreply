import { credit } from "@/lib/credit";

/** Always at the bottom: who made it and where to follow. */
export function Footer() {
  return (
    <footer className="mt-16 border-t border-white/8">
      <div className="mx-auto flex max-w-[1000px] flex-col gap-3 px-4 py-8 text-sm text-mist sm:px-6">
        <p>
          Bu sistem{" "}
          <a href={credit.site} target="_blank" rel="noopener" className="font-semibold text-white underline decoration-brand decoration-2 hover:text-brand-hover">
            {credit.siteLabel}
          </a>{" "}
          tarafından ücretsiz ve açık kaynak olarak yapıldı.{" "}
          <a href={credit.repo} target="_blank" rel="noopener" className="underline hover:text-white">
            Kaynak kodu
          </a>
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>Destek olmak istersen takip et:</span>
          {credit.socials.map((s, i) => (
            <span key={s.label} className="inline-flex items-center gap-2">
              {i > 0 && <span aria-hidden className="text-white/25">·</span>}
              <a href={s.href} target="_blank" rel="noopener" className="font-medium text-white hover:text-brand-hover">
                {s.label}
              </a>
            </span>
          ))}
          <span className="text-white/40">{credit.socials[0].handle}</span>
        </p>
      </div>
    </footer>
  );
}
