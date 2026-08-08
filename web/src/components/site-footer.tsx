import Link from "next/link";

/* The original site pointed at a university-hosted PDF that has since 404'd and
   was never archived, so there is nothing to restore. These are the live
   sources the items and profile text actually come from; the methodology page
   sets out the provenance in full. */
const SOURCE_ITEMS = "https://www.humanmetrics.com/personality";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-white/6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 text-sm text-faint sm:flex-row sm:items-center sm:justify-between">
        <p>
          The 70 items follow the{" "}
          <a
            href={SOURCE_ITEMS}
            target="_blank"
            rel="noreferrer noopener"
            className="text-mute underline decoration-white/20 underline-offset-4 transition hover:text-chalk"
          >
            public Jung typology questionnaire
          </a>
          ; the profiles are reproduced from{" "}
          <a
            href="https://www.personalitypage.com/html/ENFJ.html"
            target="_blank"
            rel="noreferrer noopener"
            className="text-mute underline decoration-white/20 underline-offset-4 transition hover:text-chalk"
          >
            The Personality Page
          </a>
          .{" "}
          <Link
            href="/methodology"
            className="text-mute underline decoration-white/20 underline-offset-4 transition hover:text-chalk"
          >
            Full provenance
          </Link>
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
