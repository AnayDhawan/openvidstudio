import fs from 'node:fs';
import path from 'node:path';

/*
 * Reads the repo root's real CHANGELOG.md at build time, same pattern as
 * lib/docs.ts uses for packages/docs/*.md: no copy kept inside apps/site,
 * so a future release entry only ever needs editing in one place.
 *
 * Resolved off process.cwd() rather than this file's own location, for the
 * same reason lib/docs.ts does: this module is bundled by webpack, so
 * import.meta.url/__dirname would point at a bundled server-chunk path, not
 * this source file's real one. The repo build command
 * (`pnpm --filter @openvidstudio/site build`, from the monorepo root) still
 * runs with apps/site as this package's own working directory.
 */
const CHANGELOG_PATH = path.resolve(process.cwd(), '..', '..', 'CHANGELOG.md');

export function getChangelog(): string {
  if (!fs.existsSync(CHANGELOG_PATH)) {
    throw new Error(
      `CHANGELOG.md not found at ${CHANGELOG_PATH}. apps/site reads the repo root's real ` +
        'CHANGELOG.md directly at build time (see lib/changelog.ts). On Vercel this means the ' +
        'project\'s Root Directory must be set to "apps/site" AND "Include source files outside ' +
        'of the Root Directory" must be enabled, the same requirement lib/docs.ts documents for ' +
        'packages/docs.'
    );
  }
  return fs.readFileSync(CHANGELOG_PATH, 'utf-8');
}
