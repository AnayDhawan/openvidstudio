import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Reveal } from '@/components/Reveal';

const mcpConfigSnippet = `{
  "mcpServers": {
    "openvidstudio": {
      "command": "npx",
      "args": ["-y", "@openvidstudio/mcp-server"]
    }
  }
}`;

const steps = [
  {
    number: '01',
    title: 'Add the server to your coding agent',
    body: 'Drop this into your MCP client config. Claude Code, Cursor, or anything else that reads a standard mcpServers block will pick it up.',
    code: mcpConfigSnippet,
  },
  {
    number: '02',
    title: 'Point it at your running app',
    body: "openvidstudio's MCP tools capture your real UI directly from the running app: real screenshots, real screen recordings, real cursor. No separate app to open, no manual keyframing.",
  },
  {
    number: '03',
    title: 'Ask your agent to build the video',
    body: 'Say something like "build a 30 second demo video of this product." Your agent runs the full intake-to-render protocol documented in this repo\'s PLANNING.md: it drafts a beats.json, shows you the full draft, and waits for your approval before writing anything to disk.',
  },
];

export function Quickstart() {
  return (
    <section id="quickstart" className="bg-background">
      <div className="mx-auto max-w-5xl px-6 py-24">
        <Reveal className="max-w-2xl">
          <p className="font-mono text-xs tracking-wide text-muted-foreground">QUICKSTART</p>
          <h2 className="mt-3 text-balance font-heading text-3xl font-semibold sm:text-4xl">
            Ask your agent to build a demo video.
          </h2>
        </Reveal>

        <ol className="mt-12 flex flex-col gap-10">
          {steps.map((step, i) => (
            <Reveal key={step.number} as="li" delayMs={i * 100} className="grid grid-cols-[auto_1fr] gap-5">
              <span className="font-mono text-sm text-muted-foreground">{step.number}</span>
              <div className="flex flex-col gap-3">
                <h3 className="font-heading text-lg font-semibold">{step.title}</h3>
                <p className="max-w-xl text-pretty text-sm text-muted-foreground">{step.body}</p>
                {step.code && (
                  <pre className="mt-1 max-w-xl overflow-x-auto rounded-xl border border-border bg-card p-4 font-mono text-xs leading-relaxed text-foreground/90">
                    <code>{step.code}</code>
                  </pre>
                )}
              </div>
            </Reveal>
          ))}
        </ol>

        {/* Gap 4 (task-1, run 3): the quickstart's own three steps only
            summarize the intake-to-render protocol; the full seven docs
            that back it live at /docs and were previously unreachable from
            the homepage. */}
        <Reveal delayMs={steps.length * 100} className="mt-10 border-t border-border pt-8">
          <Link
            href="/docs"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-foreground"
          >
            Read the full docs
            <ArrowRight className="size-3.5" />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
