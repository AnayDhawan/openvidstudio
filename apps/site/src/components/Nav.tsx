import Link from 'next/link';

const links = [
  { href: '/', label: 'Home' },
  { href: '/docs', label: 'Docs' },
  { href: '/gallery', label: 'Gallery' },
  // No confirmed public repo URL yet; wire this up once the repo is public.
  { href: '#', label: 'GitHub' },
];

export function Nav() {
  return (
    <header className="flex h-16 items-center border-b border-[var(--foreground)]/10 px-6">
      <nav className="flex items-center gap-6">
        {links.map((link) => (
          <Link
            key={link.label}
            href={link.href}
            className="text-sm text-[var(--foreground)]/80 transition-colors hover:text-[var(--foreground)]"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
