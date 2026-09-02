import { Check } from 'lucide-react';
import { Reveal } from '@/components/Reveal';

type Capability = {
  icon: string;
  label: string;
  body: string;
};

// The four things this pipeline is actually built on, one icon each (task 3's
// "capability grid"). Not a marketing feature list: MCP is the interface,
// Remotion and Playwright are the two real dependencies that do the actual
// compositing and capturing, Higgsfield is the one optional add-on, matching
// the "two tiers" split below exactly rather than inventing a fifth thing.
const capabilities: Capability[] = [
  {
    icon: 'icon-mcp',
    label: 'MCP',
    body: 'Every tool call goes through the Model Context Protocol. Any agent that speaks MCP can drive this pipeline.',
  },
  {
    icon: 'icon-remotion',
    label: 'Remotion',
    body: 'The camera, the compositing, the render: all React, all programmatic, no timeline editor.',
  },
  {
    icon: 'icon-playwright',
    label: 'Playwright',
    body: 'Real screenshots and screen recordings of your running app, captured from an actual browser.',
  },
  {
    icon: 'icon-higgsfield',
    label: 'Higgsfield',
    body: "Optional b-roll for the one gap real capture can't fill. Your subscription, your MCP connection.",
  },
];

type Tier = {
  eyebrow: string;
  title: string;
  description: string;
  points: string[];
  footnote?: string;
  accent: 'primary' | 'violet';
};

const tiers: Tier[] = [
  {
    eyebrow: 'Always on',
    title: 'Core pipeline',
    description: 'Free, no account, no key.',
    points: [
      'Built on Remotion and Playwright',
      'Real, DOM-rendered UI, captured as real screenshots and screen recordings',
      'Driven entirely through MCP tools, works with Claude Code, Cursor, or any MCP-speaking agent',
      'No cost beyond your own compute',
    ],
    accent: 'primary',
  },
  {
    eyebrow: 'Opt in',
    title: 'Higgsfield b-roll',
    description: 'Optional, for the shots real capture cannot produce.',
    points: [
      'Atmosphere and b-roll only: a desk shot, a cinematic open, an establishing texture',
      'Never carries on-screen product text or real UI',
      'Requires your own Higgsfield subscription and its MCP connector in your agent',
      'openvidstudio never holds a Higgsfield key and never bills you',
    ],
    footnote:
      "openvidstudio only imports the clip your agent already generated. It never calls Higgsfield's own generation tools itself.",
    accent: 'violet',
  },
];

export function Features() {
  const [free, optional] = tiers;

  return (
    // Composition redo (task-1, run 3): full-bleed bg-card/40 band (no
    // max-w on the section itself, only on the inner content) so this
    // section reads as a distinct shaded stage against the flat
    // bg-background used everywhere else, and a wider max-w-6xl inner
    // container to host the asymmetric tier split below. bg-card is an
    // existing token, reused here as a section background rather than a
    // new value, so globals.css stays untouched.
    <section id="features" className="border-b border-border bg-card/40">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <Reveal className="max-w-2xl">
          <p className="font-mono text-xs tracking-wide text-muted-foreground">TWO TIERS</p>
          <h2 className="mt-3 text-balance font-heading text-3xl font-semibold sm:text-4xl">
            Free by default. Optional when a shot needs it.
          </h2>
          <p className="mt-4 text-pretty text-muted-foreground">
            Almost every beat in a video comes from your product&apos;s real,
            running UI. One kind of shot genuinely can&apos;t: a beat with no
            product UI in it at all. That one gap is what the optional tier
            is for, and only for.
          </p>
        </Reveal>

        {/* Capability grid (task 3): the four things this pipeline is
            actually built on, one icon each, before the pricing-style
            tier split below rather than folded into it. */}
        <Reveal delayMs={60} className="mt-12 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {capabilities.map((capability) => (
            <div
              key={capability.label}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-card/60 p-5"
            >
              <img
                src={`/brand/${capability.icon}.png`}
                alt=""
                aria-hidden="true"
                className="size-9"
              />
              <h3 className="font-heading text-sm font-semibold">{capability.label}</h3>
              <p className="text-pretty text-xs text-muted-foreground">{capability.body}</p>
            </div>
          ))}
        </Reveal>

        {/* Asymmetric 3/2 split, not the old 50/50 grid: the free tier is
            the default/solid state (wider, filled bg-card, solid border,
            filled check bullets, and a large "$0" figure that breaks the
            page's heading/body scale on purpose). The optional tier is
            pushed down (offset, not equal-height) and reads as a lighter
            add-on: dashed border, transparent fill, smaller type, plain
            check marks. Same data, genuinely different visual weight. */}
        <div className="mt-12 grid gap-6 md:grid-cols-5">
          <Reveal className="md:col-span-3">
            <div className="flex h-full flex-col rounded-2xl border border-primary/25 bg-card p-8">
              <span className="w-fit rounded-full border border-primary/30 px-3 py-1 font-mono text-xs tracking-wide text-primary">
                {free.eyebrow}
              </span>

              <p className="mt-6 font-heading text-7xl font-semibold leading-none sm:text-8xl">
                $0
              </p>
              <h3 className="mt-5 font-heading text-xl font-semibold">{free.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{free.description}</p>

              <ul className="mt-6 flex flex-1 flex-col gap-3">
                {free.points.map((point) => (
                  <li key={point} className="flex items-start gap-3 text-sm text-foreground/90">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15">
                      <Check className="size-3 text-primary" />
                    </span>
                    <span className="text-pretty">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal delayMs={120} className="md:col-span-2 md:mt-12">
            <div className="flex h-full flex-col rounded-2xl border border-dashed border-accent/30 bg-transparent p-6">
              <span className="w-fit rounded-full border border-accent/30 px-3 py-1 font-mono text-xs tracking-wide text-accent">
                {optional.eyebrow}
              </span>

              <h3 className="mt-4 font-heading text-lg font-semibold text-foreground/90">
                {optional.title}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">{optional.description}</p>

              <ul className="mt-6 flex flex-1 flex-col gap-2.5">
                {optional.points.map((point) => (
                  <li key={point} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-accent/70" />
                    <span className="text-pretty">{point}</span>
                  </li>
                ))}
              </ul>

              {optional.footnote && (
                <p className="mt-6 text-pretty border-t border-border pt-4 text-xs text-muted-foreground">
                  {optional.footnote}
                </p>
              )}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
