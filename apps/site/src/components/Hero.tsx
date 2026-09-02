import Link from 'next/link';
import { ArrowRight, PlayCircle } from 'lucide-react';
import { Spotlight } from '@/components/ui/spotlight';
import { buttonVariants } from '@/components/ui/button';

const stackChips = ['MCP', 'Remotion', 'Playwright'];

export function Hero() {
  return (
    // Flat bg-background behind the Spotlight, no second ambient gradient
    // layered under it. A fix-round review flagged an earlier radial-mesh
    // div here as an undisclosed second B4 ("never use gradients in
    // backgrounds") deviation on top of the Spotlight glow itself; removed
    // rather than kept and re-justified, since the Spotlight alone reads
    // fine against a flat ground and a second wash wasn't earning its
    // place. See task-2-report.md's fix-round entry.
    //
    // Composition redo (task-1, run 3): widened to max-w-6xl and split into
    // an asymmetric two-column grid so the hero is the one section that
    // breaks the site's otherwise universal max-w-5xl rhythm, and so the
    // real demo video (previously unused anywhere but /gallery) reads as
    // the actual centerpiece next to the copy rather than a background
    // wash. Column ratio is deliberately uneven (6/5), not a 50/50 split.
    <section className="relative overflow-hidden border-b border-border bg-background">
      {/* Brand hero art: corners-only bokeh, center left clear by design
          (see apps/site/public/brand/ generation notes) so the live copy
          below sits on genuinely empty ground, not text laid over a busy
          image. Desktop/mobile are two separate renders, not one image
          scaled, swapped by breakpoint rather than cropped. Sits behind
          the Spotlight glow and the content grid, aria-hidden since it's
          pure decoration with no information the copy doesn't already say. */}
      <img
        src="/brand/hero-desktop.png"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 hidden h-full w-full object-cover object-top opacity-90 md:block"
      />
      <img
        src="/brand/hero-mobile.png"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover object-top opacity-90 md:hidden"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background/10 via-background/60 to-background" />
      <Spotlight
        className="left-1/2 top-0 -translate-x-1/2"
        fill="var(--warm)"
      />

      <div className="relative mx-auto grid max-w-6xl gap-14 px-6 pb-24 pt-20 md:pt-28 lg:grid-cols-[6fr_5fr] lg:items-center lg:gap-10">
        <div className="flex flex-col items-start gap-8">
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

        {/* Real product output, not a mockup: same video-embed pattern as
            gallery/page.tsx (muted, loop, playsInline, controls, poster
            fallback, preload="none"). `controls` stays on for the same WCAG
            reason Phase 6's final review required it there; no autoPlay. */}
        <div className="flex flex-col gap-3 lg:pt-2">
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/40">
            <video
              className="aspect-video w-full object-cover"
              src="/brand/openvidstudio-sample-demo.mp4"
              poster="/brand/openvidstudio-sample-demo-poster.jpg"
              muted
              loop
              playsInline
              controls
              preload="none"
            >
              Your browser does not support embedded video. Watch this demo
              on the <Link href="/gallery" className="underline">gallery page</Link> instead.
            </video>
          </div>
          <div className="flex items-center justify-between gap-4 font-mono text-xs text-muted-foreground">
            <span>16.5s, rendered end to end by this pipeline.</span>
            <Link
              href="/gallery"
              className="inline-flex shrink-0 items-center gap-1.5 text-primary transition-colors hover:text-foreground"
            >
              <PlayCircle className="size-3.5" />
              Full gallery
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
