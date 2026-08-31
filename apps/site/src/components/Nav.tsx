import Link from 'next/link';

const links = [
  { href: '/', label: 'Home' },
  { href: '/docs', label: 'Docs' },
  { href: '/gallery', label: 'Gallery' },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center border-b border-border bg-background px-6">
      <nav className="flex items-center gap-6">
        {links.map((link) => (
          <Link
            key={link.label}
            href={link.href}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
