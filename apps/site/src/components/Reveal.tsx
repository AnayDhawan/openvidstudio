'use client';

import { useEffect, useRef, useState } from 'react';

type RevealProps = {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
  /**
   * Element type to render as. Defaults to 'div'. Pass 'li' when Reveal is
   * used directly inside an <ol>/<ul> (e.g. Quickstart.tsx's steps list) so
   * the list semantics stay valid for assistive tech instead of a <div>
   * sitting between the list and its <li> children.
   */
  as?: 'div' | 'li';
};

/**
 * Fades/translates children into place once they cross into the viewport.
 * IntersectionObserver-driven (never a scroll listener, see
 * elayadesign/landing-page-design's B7) and respects prefers-reduced-motion
 * via the .reveal-init/.reveal-in CSS in globals.css.
 */
export function Reveal({ children, className, delayMs = 0, as = 'div' }: RevealProps) {
  const ref = useRef<HTMLDivElement & HTMLLIElement>(null);
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
      { threshold: 0.2 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const Tag = as;

  return (
    <Tag
      ref={ref}
      className={`${visible ? 'reveal-in' : 'reveal-init'} ${className ?? ''}`}
      style={visible && delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
