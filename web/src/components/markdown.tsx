"use client";

import { Fragment, type ReactNode } from "react";

/* Minimal markdown renderer for assistant replies.

   The model writes markdown, so rendering it as plain text leaves literal
   ** and * on screen. This builds React elements directly rather than setting
   innerHTML, so model output can never inject markup. Only the subset the
   assistant actually produces is supported: headings, bullet and numbered
   lists, bold, italic and inline code. */

/** Splits one line into bold / italic / code spans. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Order matters: ** before *, so bold wins over italic.
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;

    if (token.startsWith("**") || token.startsWith("__")) {
      out.push(
        <strong key={key} className="font-semibold text-chalk">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      out.push(
        <code key={key} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, i) => (
      <li key={i} className="ml-4 list-outside">
        {inline(item, `li-${key}-${i}`)}
      </li>
    ));
    blocks.push(
      list.ordered ? (
        <ol key={`b${key++}`} className="list-decimal space-y-1">
          {items}
        </ol>
      ) : (
        <ul key={`b${key++}`} className="list-disc space-y-1">
          {items}
        </ul>
      ),
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      blocks.push(
        <p className="font-medium text-chalk" key={`b${key++}`}>
          {inline(heading[2], `h${key}`)}
        </p>,
      );
      continue;
    }

    // A line that is only bold acts as a heading in practice.
    const boldOnly = /^\*\*(.+)\*\*:?$/.exec(line.trim());
    if (boldOnly) {
      flushList();
      blocks.push(
        <p className="font-medium text-chalk" key={`b${key++}`}>
          {boldOnly[1]}
        </p>,
      );
      continue;
    }

    if (/^\s*[-*•]\s+/.test(line)) {
      const item = line.replace(/^\s*[-*•]\s+/, "");
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(item);
      continue;
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]);
      continue;
    }

    if (/^\s*([-–—*_])\1{2,}\s*$/.test(line)) {
      flushList();
      blocks.push(<hr key={`b${key++}`} className="border-white/10" />);
      continue;
    }

    flushList();
    blocks.push(<p key={`b${key++}`}>{inline(line, `p${key}`)}</p>);
  }
  flushList();

  return (
    <div className="space-y-2 leading-relaxed">
      {blocks.map((b, i) => (
        <Fragment key={i}>{b}</Fragment>
      ))}
    </div>
  );
}
