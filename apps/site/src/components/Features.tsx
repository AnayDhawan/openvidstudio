import { Check } from 'lucide-react';
import { Reveal } from '@/components/Reveal';

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
  return (
    <section id="features" className="border-b border-border bg-background">
      <div className="mx-auto max-w-5xl px-6 py-24">
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

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {tiers.map((tier, i) => (
            <Reveal key={tier.title} delayMs={i * 120}>
              <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-6">
                <div className="flex items-center justify-between">
                  <span
                    className={
                      'rounded-full border px-3 py-1 font-mono text-xs tracking-wide ' +
                      (tier.accent === 'primary'
                        ? 'border-primary/30 text-primary'
                        : 'border-accent/30 text-accent')
                    }
                  >
                    {tier.eyebrow}
                  </span>
                </div>

                <h3 className="mt-4 font-heading text-xl font-semibold">{tier.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{tier.description}</p>

                <ul className="mt-6 flex flex-1 flex-col gap-3">
                  {tier.points.map((point) => (
                    <li key={point} className="flex items-start gap-3 text-sm text-foreground/90">
                      <Check
                        className={
                          'mt-0.5 size-4 shrink-0 ' +
                          (tier.accent === 'primary' ? 'text-primary' : 'text-accent')
                        }
                      />
                      <span className="text-pretty">{point}</span>
                    </li>
                  ))}
                </ul>

                {tier.footnote && (
                  <p className="mt-6 text-pretty border-t border-border pt-4 text-xs text-muted-foreground">
                    {tier.footnote}
                  </p>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
