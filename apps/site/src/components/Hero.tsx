import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Spotlight } from '@/components/ui/spotlight';
import { buttonVariants } from '@/components/ui/button';

const stackChips = ['MCP', 'Remotion', 'Playwright'];

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% -10%, var(--background-2), var(--background))',
        }}
      />
      <Spotlight
        className="left-1/2 top-0 -translate-x-1/2"
        fill="var(--warm)"
      />

      <div className="relative mx-auto flex max-w-5xl flex-col items-start gap-8 px-6 pb-24 pt-20 md:pt-28">
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
          {stackChips.map((chip, i) => (
            <span key={chip} className="flex items-center gap-2">
              <span className="rounded-full border border-border bg-card px-3 py-1 tracking-wide">
                {chip}
              </span>
              {i < stackChips.length - 1 && <span aria-hidden="true">·</span>}
            </span>
          ))}
        </div>

        <h1 className="max-w-2xl text-balance bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text font-heading text-4xl font-semibold leading-tight text-transparent sm:text-5xl md:text-6xl">
          Turn your real UI into a cinematic demo video.
        </h1>

        <p className="max-w-2xl text-pretty text-lg text-muted-foreground">
          openvidstudio is a free, open-source MCP server. Point Claude Code
          or Cursor at your running app, and it captures the real screens and
          the real cursor, then cuts a cinematic video from that footage. No
          editor to open, no AI guessing at what your product looks like.
        </p>

        <div className="flex flex-wrap items-center gap-4">
          <Link href="#quickstart" className={buttonVariants({ size: 'lg', className: 'h-11 gap-1.5 px-5 text-base' })}>
            Get started
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href="#features"
            className={buttonVariants({ variant: 'outline', size: 'lg', className: 'h-11 px-5 text-base' })}
          >
            See what&apos;s free
          </Link>
        </div>

        <p className="font-mono text-xs text-muted-foreground">
          Apache 2.0 licensed. No API key required to start.
        </p>
      </div>
    </section>
  );
}
