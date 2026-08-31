'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { DocMeta } from '@/lib/docs';

type DocsSidebarProps = {
  docs: DocMeta[];
};

/**
 * Persistent secondary nav for /docs/*. Distinct component from Nav.tsx's
 * top-level nav (this one highlights an active entry and lives inside the
 * docs layout only), but reuses its visual language: same border/muted-fg
 * conventions as Nav.tsx's links, not a new nav style invented from
 * scratch.
 */
export function DocsSidebar({ docs }: DocsSidebarProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Docs"
      className="mb-8 flex gap-2 overflow-x-auto border-b border-border pb-4 md:sticky md:top-24 md:mb-0 md:h-fit md:w-56 md:shrink-0 md:flex-col md:gap-1 md:overflow-visible md:border-b-0 md:pb-0"
    >
      <p className="hidden font-mono text-xs tracking-wide text-muted-foreground md:mb-2 md:block">
        DOCS
      </p>
      {docs.map((doc) => {
        const href = `/docs/${doc.slug}`;
        const isActive = pathname === href;
        return (
          <Link
            key={doc.slug}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'shrink-0 whitespace-nowrap rounded-lg border px-3 py-2 text-sm transition-colors md:whitespace-normal',
              isActive
                ? 'border-border bg-card text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-card/60'
            )}
          >
            {doc.title}
          </Link>
        );
      })}
    </nav>
  );
}
