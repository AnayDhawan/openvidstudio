import Link from 'next/link';

// Full IA (task 4): every route the site now has, in the order a visitor
// would want to read them: what it is, how it works, the protocol it runs
// on, why it's different, the docs, proof it works, and the history.
const links = [
  { href: '/', label: 'Home' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/mcp', label: 'MCP' },
  { href: '/compare', label: 'Compare' },
  { href: '/docs', label: 'Docs' },
  { href: '/gallery', label: 'Gallery' },
  { href: '/changelog', label: 'Changelog' },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-8 border-b border-border bg-background px-6">
      <Link href="/" className="flex shrink-0 items-center" aria-label="openvidstudio home">
        {/* logo-primary.png is the mark+wordmark combo, already sized for a
            single-row nav bar (see apps/site/public/brand/). Fixed height,
            auto width so it doesn't distort. Hidden below sm and swapped
            for the mark alone, since the full wordmark crowds a narrow
            header next to seven nav links. */}
        <img
          src="/brand/logo-mark.png"
          alt="openvidstudio"
          className="h-7 w-7 sm:hidden"
        />
        <img
          src="/brand/logo-primary.png"
          alt="openvidstudio"
          className="hidden h-7 w-auto sm:block"
        />
      </Link>
      <nav className="flex flex-1 items-center gap-5 overflow-x-auto">
        {links.map((link) => (
          <Link
            key={link.label}
            href={link.href}
            className="shrink-0 whitespace-nowrap text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
