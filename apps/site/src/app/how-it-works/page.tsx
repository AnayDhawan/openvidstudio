import type { Metadata } from 'next';
import { Reveal } from '@/components/Reveal';

export const metadata: Metadata = {
  title: 'How it works - openvidstudio',
  description:
    'The five-step pipeline from a brief to a rendered video: beats.json, capture, scaffold, stitch, render.',
};

type Step = {
  icon: string;
  number: string;
  title: string;
  tools: string[];
  body: string;
};

// One section per pipeline step, task 4. Content and tool names are pulled
// directly from PIPELINE.md and PLANNING.md (packages/docs/), not
// paraphrased into generic marketing language. Five steps to match the five
// pipeline icons in apps/site/public/brand/: intake and capture-method
// decisions fold into step 1, and render plus the QC loop fold into step 5,
// the same grouping PIPELINE.md itself uses (its own "## 4. Preview + QC
// loop" section sits right before "## 5. Render + exports").
const steps: Step[] = [
  {
    icon: 'icon-validate',
    number: '01',
    title: 'Intake becomes beats.json',
    tools: ['validate_beats', 'write_beats_file'],
    body:
      "Your agent asks PLANNING.md's guided questions (product, features to demo, target " +
      'length, Higgsfield access, brand info, existing assets), or reads them out of a ' +
      'README or feature list you paste in instead. For every feature, it runs the ' +
      'capture-method decision tree: a held state becomes a screenshot, something that ' +
      "changes over time becomes a recording, a claim the product can't back yet becomes " +
      'a labeled dom-demo, and a shot with no product UI in it at all (optionally) becomes ' +
      'Higgsfield b-roll. The draft is a beats.json: fps, title, and a contiguous list of ' +
      'beats, each with a start frame, a duration, VO, and a decided captureMethod. ' +
      'validate_beats checks the schema and structure before anything touches disk, and ' +
      'write_beats_file refuses to write a file validate_beats hasn\'t passed. Neither tool ' +
      'enforces the actual approval gate: your agent is required to show you the full draft ' +
      'and get your explicit yes before it writes anything, every time, even for a small ' +
      'obviously-fine-looking draft.',
  },
  {
    icon: 'icon-capture',
    number: '02',
    title: 'Real capture, not a guess',
    tools: ['capture_screenshot', 'capture_screen_recording'],
    body:
      'Every screenshot and recording beat gets captured for real, against your actual ' +
      'running app, through Playwright. This is also where the pipeline earns its ' +
      "\"nothing hallucinated\" claim: these tools drive a real browser to the beat's URL, " +
      'run its interactions (click, fill, select, hover, scroll, wait), and save the result ' +
      "at the exact asset path the rest of the pipeline expects (public/images/<beatId>.png " +
      'or public/video/<beatId>.mp4). Internally they follow CAPTURE.md\'s zoom-compensation ' +
      'protocol: a Playwright browser profile can carry a per-origin zoom level that silently ' +
      'desyncs the requested viewport from what Chrome actually renders, and an uncorrected ' +
      'capture reliably comes out small, soft, or bleeding in a neighboring section. Both ' +
      'tools measure and compensate for that automatically instead of trusting a resize at ' +
      'face value.',
  },
  {
    icon: 'icon-scaffold',
    number: '03',
    title: 'Scenes get scaffolded',
    tools: ['scaffold_scene'],
    body:
      'One scene file per beat. scaffold_scene generates the right shape for whatever ' +
      "captureMethod that beat decided on: a captured screenshot renders inside a " +
      'BrowserFrame, a recording composites as an OffthreadVideo on the same camera-keyframe ' +
      'pattern, a dom-demo is a hand-coded panel built from your project\'s real design ' +
      'tokens and copy, and a higgsfield-clip scene is structurally identical to a real ' +
      'recording scene once the clip lands at its asset path. Every scene is wrapped in a ' +
      'CinematicScene (grain, vignette, and grade always on) with camera keyframes: motion ' +
      'never stops, and STYLE.md fails QC on a static frame.',
  },
  {
    icon: 'icon-stitch',
    number: '04',
    title: 'Composition gets stitched',
    tools: ['stitch_composition'],
    body:
      'stitch_composition assembles every scene into a single <Series>, in beats.json order, ' +
      "with each scene's duration taken straight from its beat. It also wires up narration " +
      'and music where the files exist: it checks public/audio/vo/<beatId>.mp3 for every ' +
      'beat and public/audio/music-bed.mp3 once, and silently skips the audio layer for any ' +
      "file that isn't there. That omission is silent by design, not an error. It renders " +
      'fine with a beat missing its VO; the QC checklist is the actual backstop, not a tool ' +
      'error.',
  },
  {
    icon: 'icon-render',
    number: '05',
    title: 'Render, then QC',
    tools: ['render_video', 'qc_extract_frames'],
    body:
      'render_video runs the actual Remotion render to an mp4. qc_extract_frames then pulls ' +
      "still frames at each beat's midpoint (and, for a real-capture beat specifically, its " +
      'end too, since a crop that looks fine early can push the payoff off the bottom of ' +
      'frame once the camera has zoomed in) so your agent can check the PIPELINE.md ' +
      'checklist against real output: crisp text at every zoom level, zero linear easing, ' +
      'visible captions, no em dashes on screen, SFX landing on the visual events, and beat ' +
      "durations matching beats.json. This loop is meant to run more than once: it's a QC " +
      'loop, not a one-shot render.',
  },
];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <Reveal className="max-w-2xl">
        <p className="font-mono text-xs tracking-wide text-muted-foreground">HOW IT WORKS</p>
        <h1 className="mt-3 text-balance font-heading text-3xl font-semibold sm:text-4xl">
          Brief in, video out, five real steps.
        </h1>
        <p className="mt-4 text-pretty text-muted-foreground">
          This is the actual pipeline your agent runs, tool by tool, not a simplified
          overview. Full detail lives in{' '}
          <a href="/docs/pipeline" className="text-primary underline underline-offset-4">
            PIPELINE.md
          </a>{' '}
          and{' '}
          <a href="/docs/planning" className="text-primary underline underline-offset-4">
            PLANNING.md
          </a>
          .
        </p>
      </Reveal>

      <ol className="mt-14 flex flex-col gap-14">
        {steps.map((step, i) => (
          <Reveal key={step.number} as="li" delayMs={i * 80}>
            <div className="grid gap-5 sm:grid-cols-[auto_1fr] sm:gap-6">
              <div className="flex items-center gap-4 sm:flex-col sm:items-start sm:gap-3">
                <img src={`/brand/${step.icon}.png`} alt="" aria-hidden="true" className="size-11 shrink-0" />
                <span className="font-mono text-xs text-muted-foreground">{step.number}</span>
              </div>
              <div className="flex flex-col gap-3 border-t border-border pt-5 sm:border-t-0 sm:pt-0">
                <h2 className="font-heading text-xl font-semibold">{step.title}</h2>
                <div className="flex flex-wrap gap-2">
                  {step.tools.map((tool) => (
                    <code
                      key={tool}
                      className="rounded-full border border-border bg-card px-2.5 py-1 font-mono text-xs text-foreground/90"
                    >
                      {tool}
                    </code>
                  ))}
                </div>
                <p className="max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </div>
            </div>
          </Reveal>
        ))}
      </ol>
    </div>
  );
}
