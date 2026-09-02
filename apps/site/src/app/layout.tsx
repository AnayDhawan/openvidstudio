import type { Metadata } from 'next';
import { Inter, Inter_Tight, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Nav } from '@/components/Nav';

// Body/UI text. Matches packages/docs/STYLE.md's own "Fonts: Inter (UI)"
// rule, so the site's text and every video this pipeline renders share a
// typeface rather than the site inventing its own.
const inter = Inter({ variable: '--font-sans', subsets: ['latin'] });

// Display type for headings only: same family as the body font but with
// the tighter tracking a landing-page H1 needs, so headings don't read as
// plain default-weight Inter (the exact AI-slop look the web-design-skills
// plugin's Linear recipe warns against).
const interTight = Inter_Tight({ variable: '--font-heading', subsets: ['latin'], weight: ['600', '700'] });

// Code/terminal text: matches STYLE.md's "JetBrains Mono (terminal/code)".
const jetbrainsMono = JetBrains_Mono({ variable: '--font-mono', subsets: ['latin'], weight: ['400', '500'] });

const title = 'openvidstudio';
const description =
  'Free, open-source video-generation add-on for any software project, driven entirely through MCP tools.';

// Placeholder domain: there is no real deploy domain yet. Update this once
// the site has a real domain (metadataBase is required for Next to resolve
// the relative OG/Twitter image path below into an absolute URL).
const siteUrl = new URL('https://openvidstudio.dev');

// Fallback OG/Twitter image for any route that doesn't set its own. Every
// real route now carries a dedicated opengraph-image.png (see each route's
// own file under src/app/), which Next's metadata resolution overrides this
// with automatically; this is what a not-yet-built route would fall back to.
const ogImage = '/brand/og/home.png';

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title,
  description,
  openGraph: {
    title,
    description,
    type: 'website',
    images: [ogImage],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: [ogImage],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${interTight.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans antialiased bg-background text-foreground">
        <Nav />
        {children}
      </body>
    </html>
  );
}
