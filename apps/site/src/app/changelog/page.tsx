import type { Metadata } from 'next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Reveal } from '@/components/Reveal';
import { getChangelog } from '@/lib/changelog';

export const metadata: Metadata = {
  title: 'Changelog - openvidstudio',
  description: 'Real, Keep a Changelog formatted history of openvidstudio, read from the repo root.',
};

export default function ChangelogPage() {
  const content = getChangelog();

  return (
    <div className="relative">
      {/* Sparse background, task 4: same low-opacity treatment as /compare,
          confined to the header area rather than tiled behind the full
          changelog body. */}
      <img
        src="/brand/texture-changelog.png"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] w-full object-cover opacity-[0.08]"
      />

      <div className="mx-auto max-w-3xl px-6 py-16">
        <Reveal className="max-w-2xl">
          <p className="font-mono text-xs tracking-wide text-muted-foreground">CHANGELOG</p>
          <h1 className="mt-3 text-balance font-heading text-3xl font-semibold sm:text-4xl">
            What actually shipped.
          </h1>
          <p className="mt-4 text-pretty text-muted-foreground">
            This page renders the repo&apos;s real CHANGELOG.md directly, not a rewritten copy.
          </p>
        </Reveal>

        <Reveal delayMs={80} className="docs-prose prose mt-12 max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </Reveal>
      </div>
    </div>
  );
}
