import fs from 'node:fs';
import path from 'node:path';

/*
 * Single-source reader for packages/docs/*.md.
 *
 * apps/site and packages/docs are sibling workspace packages
 * (pnpm-workspace.yaml). This module reads the real files at build time
 * (this is a static-export site, `output: 'export'` in next.config.ts, so
 * there is no runtime fs access, everything below only ever runs during
 * `next build`) and never copies doc content into apps/site itself. If a
 * doc's text changes in packages/docs/, the next build picks it up with
 * zero manual sync step.
 *
 * DOCS_DIR is resolved off process.cwd() rather than off this file's own
 * location: this module is bundled by webpack for Next's build, so
 * `import.meta.url`/`__dirname` would point at a bundled server-chunk
 * path, not this source file's real path. process.cwd() is reliable
 * instead — this repo's actual build command is
 * `pnpm --filter @openvidstudio/site build`, run from the monorepo root,
 * and pnpm --filter still execs that package's "build" script with
 * apps/site as the working directory (verified directly: `pnpm --filter
 * @openvidstudio/site exec node -e "console.log(process.cwd())"` prints
 * .../apps/site regardless of the invoking shell's own cwd), same as
 * `cd apps/site && next build` would.
 */
const DOCS_DIR = path.resolve(process.cwd(), '..', '..', 'packages', 'docs');

export type DocMeta = {
  slug: string;
  filename: string;
  title: string;
  description: string;
};

// Preferred display/nav order for the docs that currently exist, matching
// OVERVIEW.md's own "## Doc map" table (OVERVIEW itself first, as the
// index/landing entry). This is an *order preference* only, not the
// source of the doc set: listDocFilenames() below always derives the
// actual set of files from a real fs.readdirSync(DOCS_DIR), so /docs
// can't silently go stale if packages/docs/ gains, loses, or renames a
// file. A doc not listed here (e.g. a newly added one) just sorts after
// the ones that are, alphabetically, rather than being dropped.
const DISPLAY_ORDER = [
  'OVERVIEW.md',
  'PIPELINE.md',
  'STYLE.md',
  'CAPTURE.md',
  'PLANNING.md',
  'SCRIPT.md',
  'HIGGSFIELD.md',
];

function listDocFilenames(): string[] {
  if (!fs.existsSync(DOCS_DIR)) {
    throw new Error(
      `packages/docs not found at ${DOCS_DIR}. apps/site reads that directory directly at ` +
        `build time (see the module comment above). On Vercel this means the project's Root ` +
        `Directory must be set to "apps/site" AND the "Include source files outside of the ` +
        'Root Directory" option must be enabled, or packages/docs is simply absent from the ' +
        'build. Fix the Vercel project settings and redeploy.'
    );
  }
  const filenames = fs.readdirSync(DOCS_DIR).filter((name) => name.endsWith('.md'));
  return filenames.sort((a, b) => {
    const ia = DISPLAY_ORDER.indexOf(a);
    const ib = DISPLAY_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function slugFor(filename: string): string {
  return filename.replace(/\.md$/, '').toLowerCase();
}

function readDoc(filename: string): string {
  return fs.readFileSync(path.join(DOCS_DIR, filename), 'utf-8');
}

// Every doc here shares one H1 convention: "# FILENAME.md: subtitle".
// Derive the nav/page title from the subtitle half instead of hand-typing
// a title per doc, so a rename of the doc's own heading doesn't silently
// go stale here.
function titleFrom(content: string): string {
  const h1 = content.split(/\r?\n/).find((line) => line.startsWith('# ')) ?? '';
  const withoutHash = h1.replace(/^#\s*/, '');
  const colonIdx = withoutHash.indexOf(':');
  const raw = colonIdx === -1 ? withoutHash : withoutHash.slice(colonIdx + 1).trim();
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// OVERVIEW.md's own "## Doc map" table already carries a reviewed,
// one-line description per other doc. Parse that table instead of
// re-typing those descriptions a second time here, so the /docs index
// can't drift from OVERVIEW.md's own text.
function parseDocMap(overviewContent: string): Record<string, string> {
  const lines = overviewContent.split(/\r?\n/);
  const headerIdx = lines.findIndex((line) => /^\|\s*Doc\s*\|/.test(line.trim()));
  const map: Record<string, string> = {};
  if (headerIdx === -1) return map;
  // headerIdx + 1 is the `|---|---|` separator row; data rows start after it.
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) break;
    const cells = line
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length < 2) continue;
    map[cells[0].replace(/`/g, '')] = cells[1];
  }
  return map;
}

// OVERVIEW.md doesn't describe itself in its own doc-map table (the table
// only covers the other six), so its index description is the first
// sentence of its own opening paragraph instead.
function firstSentenceOfOpeningParagraph(content: string): string {
  const lines = content.split(/\r?\n/);
  let i = 1; // skip the H1 line
  while (i < lines.length && lines[i].trim() === '') i++;
  const paragraph: string[] = [];
  while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('#')) {
    paragraph.push(lines[i].trim());
    i++;
  }
  const text = paragraph.join(' ');
  const sentence = text.match(/^.*?[.!?](?=\s|$)/);
  return (sentence ? sentence[0] : text).trim();
}

let cache: DocMeta[] | null = null;

export function getAllDocsMeta(): DocMeta[] {
  if (cache) return cache;
  const overviewContent = readDoc('OVERVIEW.md');
  const docMap = parseDocMap(overviewContent);

  cache = listDocFilenames().map((filename) => {
    const content = filename === 'OVERVIEW.md' ? overviewContent : readDoc(filename);
    const description =
      filename === 'OVERVIEW.md'
        ? firstSentenceOfOpeningParagraph(overviewContent)
        : (docMap[filename] ?? '');
    return {
      slug: slugFor(filename),
      filename,
      title: titleFrom(content),
      description,
    };
  });
  return cache;
}

export function getDocBySlug(slug: string): { meta: DocMeta; content: string } | null {
  const meta = getAllDocsMeta().find((doc) => doc.slug === slug);
  if (!meta) return null;
  return { meta, content: readDoc(meta.filename) };
}
