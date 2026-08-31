import type { Metadata } from 'next';
import { Reveal } from '@/components/Reveal';
import { GALLERY_ENTRIES } from '@/lib/gallery';

export const metadata: Metadata = {
  title: 'Gallery - openvidstudio',
  description: 'Real videos built end to end by the openvidstudio MCP pipeline.',
};

export default function GalleryPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <Reveal className="max-w-2xl">
        <p className="font-mono text-xs tracking-wide text-muted-foreground">GALLERY</p>
        <h1 className="mt-3 text-balance font-heading text-3xl font-semibold sm:text-4xl">
          Built by the pipeline, not by hand.
        </h1>
        <p className="mt-4 text-pretty text-muted-foreground">
          Every clip below ran through the full openvidstudio MCP pipeline for real: beats
          drafted and validated, scenes scaffolded, screens actually captured, the
          composition stitched, and the video actually rendered. Nothing here was hand-edited
          after the fact.
        </p>
      </Reveal>

      <div className="mt-12 flex flex-col gap-10">
        {GALLERY_ENTRIES.map((entry, i) => (
          <Reveal key={entry.id} delayMs={i * 80}>
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="relative aspect-video w-full bg-background">
                <video
                  className="absolute inset-0 h-full w-full object-cover"
                  src={entry.mp4}
                  poster={entry.poster}
                  muted
                  loop
                  playsInline
                  controls
                  preload="none"
                />
              </div>
              <div className="p-6">
                <h2 className="font-heading text-lg font-semibold">{entry.title}</h2>
                <p className="mt-2 text-pretty text-sm text-muted-foreground">{entry.caption}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
