import Link from "next/link";

const SOURCE_PDF =
  "https://www.dsu.univr.it/documenti/OccorrenzaIns/matdid/matdid182490.pdf";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-white/6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 text-sm text-faint sm:flex-row sm:items-center sm:justify-between">
        <p>
          The 70 questions and type profiles come from{" "}
          <a
            href={SOURCE_PDF}
            target="_blank"
            rel="noreferrer noopener"
            className="text-mute underline decoration-white/20 underline-offset-4 transition hover:text-chalk"
          >
            this source
          </a>
          . Indicative, not diagnostic.
        </p>
        <p>
          Built by{" "}
          <a
            href="https://github.com/shashvat-singham"
            target="_blank"
            rel="noreferrer noopener"
            className="text-mute underline decoration-white/20 underline-offset-4 transition hover:text-chalk"
          >
            Shashvat Singham
          </a>
          {" · "}
          <Link href="/types" className="transition hover:text-chalk">
            Browse all sixteen
          </Link>
        </p>
      </div>
    </footer>
  );
}
