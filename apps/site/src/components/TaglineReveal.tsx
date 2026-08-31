'use client';

import { useEffect, useRef, useState } from 'react';

const lines = [
  'Every pixel in the video came from your real product.',
  'Nothing here was hallucinated by a model.',
];

/**
 * The mandatory tagline-reveal moment (elayadesign/landing-page-design
 * B11): large type, own section, words activate one at a time in reading
 * order as the section scrolls into view. Restates OVERVIEW.md's own
 * "nothing on screen is invented" claim rather than a generic tagline.
 */
export function TaglineReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  let wordIndex = 0;

  return (
    <section className="border-b border-border bg-background">
      <div className="mx-auto max-w-4xl px-6 py-24">
        <div ref={ref} className="max-w-3xl font-heading text-3xl font-semibold leading-snug sm:text-4xl md:text-5xl">
          {lines.map((line) => (
            <p key={line} className="text-balance">
              {line.split(' ').map((word) => {
                const delay = wordIndex * 45;
                wordIndex += 1;
                return (
                  <span
                    key={`${word}-${delay}`}
                    className="mr-[0.28em] inline-block transition-[color,filter] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{
                      transitionDelay: `${delay}ms`,
                      color: visible ? 'var(--foreground)' : 'color-mix(in oklab, var(--foreground) 28%, transparent)',
                    }}
                  >
                    {word}
                  </span>
                );
              })}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
