import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import { Reveal } from '@/components/Reveal';
import { getAllDocsMeta } from '@/lib/docs';

export const metadata: Metadata = {
  title: 'Docs - openvidstudio',
  description: 'The seven docs behind the openvidstudio pipeline, from intake to render.',
};

// Descriptions are pulled verbatim from OVERVIEW.md's own doc-map table
// (see lib/docs.ts), which uses inline `code` spans same as any other
// markdown. This isn't run through the full ReactMarkdown pipeline (it's
// a one-line card description, not doc body), so backtick spans are
// rendered by hand instead of left as literal backtick characters.
function renderDescription(text: string) {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith('`') && part.endsWith('`') ? (
      <code
        key={i}
        className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[0.8em] text-foreground/90"
      >
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    )
  );
}

export default function DocsIndexPage() {
  const docs = getAllDocsMeta();

  return (
    <div>
      <Reveal className="max-w-2xl">
        <p className="font-mono text-xs tracking-wide text-muted-foreground">DOCS</p>
        <h1 className="mt-3 text-balance font-heading text-3xl font-semibold sm:text-4xl">
          Everything the pipeline runs on.
        </h1>
        <p className="mt-4 text-pretty text-muted-foreground">
          These seven files are what a calling agent actually reads, in order, to turn a brief
          into a rendered video. This page renders them directly, not a rewritten copy.
        </p>
      </Reveal>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {docs.map((doc, i) => (
          <Reveal key={doc.slug} delayMs={i * 60}>
            <Link
              href={`/docs/${doc.slug}`}
              className="group flex h-full flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/40"
            >
              <span className="font-mono text-xs tracking-wide text-muted-foreground">
                {doc.filename}
              </span>
              <h2 className="mt-3 font-heading text-lg font-semibold">{doc.title}</h2>
              <p className="mt-2 flex-1 text-pretty text-sm text-muted-foreground">
                {renderDescription(doc.description)}
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm text-primary opacity-0 transition-opacity group-hover:opacity-100">
                Read
                <ArrowRight className="size-3.5" />
              </span>
            </Link>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
