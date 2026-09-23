import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { inflateRawSync } from "node:zlib";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveProjectRoot, sanitizeRelativeOutPath, spawnCapture } from "../util";
import { runTool } from "./mcp";

/**
 * Finding and importing a music bed from two public-domain catalogs.
 *
 * The built-in pack has two beds and both are synthesized: music-bed.mp3 (an ambient
 * drone) and pulse-bed.mp3 (112bpm, exact cue grid). They exist so a scaffolded project
 * has music at all without anyone downloading anything, and they are deliberately plain.
 * A launch video usually wants a real track. That used to mean sending the user to
 * Pixabay by hand, the same path plan_sound_effects takes for effects.
 *
 * These two catalogs are a better answer for music specifically, because both are
 * CC0-1.0: public domain, no attribution owed, commercial use fine, nothing to put in a
 * video description.
 *
 *   lofi  btahir/open-lofi            166 lo-fi tracks in 10 categories, generated with
 *                                     Suno by their author and released CC0.
 *   cc0   SoundSafari/CC0-1.0-Music   ~9000 tracks aggregated from freepd, chosic, Free
 *                                     Music Archive, freesound and Pixabay. Wider range
 *                                     (orchestral, electronic, jazz, ambient) and much
 *                                     more variable quality.
 *
 * On the CC0 corpus specifically: it is community-aggregated and runs on takedown
 * requests, so its CC0 claim per track is the maintainer's, not a licence you have seen.
 * For a product video that is a reasonable risk and the provenance file records exactly
 * where the file came from. For anything where a wrong licence is expensive, open the
 * track's page on the originating site first. open-lofi is the safer of the two: one
 * author, one release, one licence statement covering all of it.
 *
 * Nothing is vendored into this package: a 554MB zip and a 40GB corpus do not belong in
 * an npm dependency. Two mechanics keep imports small:
 *
 * 1. open-lofi ships its tracks only inside one release zip. A zip is random-access, so
 *    import_music_bed reads the end-of-central-directory record and the central directory
 *    with HTTP range requests, then fetches just that member's compressed bytes (a few MB)
 *    and inflates them. The 554MB is never downloaded.
 * 2. The CC0 corpus stores tracks as ordinary blobs, so a single raw.githubusercontent
 *    request is enough.
 *
 * The catalog index (titles, sizes, zip offsets) is cached at output/music-index.json,
 * which is gitignored in a scaffolded project, so searching is a local file read after
 * the first call.
 */

const LOFI_REPO = "btahir/open-lofi";
const CC0_REPO = "SoundSafari/CC0-1.0-Music";
const LOFI_CATALOG_URL = `https://raw.githubusercontent.com/${LOFI_REPO}/main/catalog.json`;

const SOURCE_META = {
  lofi: { repo: LOFI_REPO, url: `https://github.com/${LOFI_REPO}`, licence: "CC0-1.0" },
  cc0: { repo: CC0_REPO, url: `https://github.com/${CC0_REPO}`, licence: "CC0-1.0" },
} as const;

type SourceKey = keyof typeof SOURCE_META;

interface ZipMember {
  method: number;
  csize: number;
  usize: number;
  localOff: number;
}

interface IndexedTrack {
  id: string;
  source: SourceKey;
  title: string;
  category: string;
  categoryLabel: string;
  filename: string;
  bytes: number;
  /** Present for lofi tracks only: where this track's bytes sit inside the release zip. */
  zip?: ZipMember;
}

interface MusicIndex {
  builtAt: string;
  zipUrl: string;
  lofiCategories: Record<string, string>;
  tracks: IndexedTrack[];
}

export interface FindMusicBedInput {
  projectRoot?: string;
  query?: string;
  source?: "lofi" | "cc0" | "any";
  category?: string;
  limit?: number;
  refresh?: boolean;
}

export interface MusicCandidate {
  id: string;
  title: string;
  source: SourceKey;
  category: string;
  megabytes: number;
  licence: string;
  sourceRepo: string;
}

export interface FindMusicBedResult {
  query: string;
  indexedAt: string;
  trackCount: number;
  candidates: MusicCandidate[];
  categories: { lofi: Record<string, string>; cc0: string[] };
  licenceNote: string;
  /** False when nothing matched the query and the candidates are a plain sample instead. */
  matchedQuery: boolean;
  nextStep: string;
}

export interface ImportMusicBedInput {
  projectRoot?: string;
  id: string;
  out?: string;
  seconds?: number;
  start?: number;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  lufs?: number;
  raw?: boolean;
}

export interface ImportMusicBedResult {
  file: string;
  durationSeconds: number | null;
  bytes: number;
  track: { id: string; title: string; category: string; sourceRepo: string; licence: string };
  processing: string;
  provenanceFile: string;
  ledgerFile: string;
  licenceNote: string;
  nextStep: string;
}

// ── http ──────────────────────────────────────────────────────────────────────

function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "openvidstudio-mcp",
    Accept: "application/vnd.github+json",
  };
  // Unauthenticated is 60 requests/hour and an index build costs about seven, so a token
  // is only worth setting on a machine that rebuilds the index repeatedly.
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: apiHeaders() });
  if (!res.ok) {
    const hint =
      res.status === 403
        ? " GitHub's unauthenticated rate limit is 60 requests an hour; set GITHUB_TOKEN to raise it."
        : "";
    throw new Error(`GET ${url} returned HTTP ${res.status}.${hint}`);
  }
  return (await res.json()) as T;
}

async function getRange(url: string, start: number, end: number): Promise<Buffer> {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, redirect: "follow" });
  if (res.status !== 206 && res.status !== 200) {
    throw new Error(`Range request ${start}-${end} on ${url} returned HTTP ${res.status}.`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ── index ─────────────────────────────────────────────────────────────────────

/**
 * Reads the release zip's central directory over HTTP, which is what makes a single-track
 * import cheap: every member's offset and compressed size is known without downloading
 * the archive. Classic (non-ZIP64) records are enough here, and asserted rather than
 * assumed: 554MB and 166 entries are both far inside the 32-bit limits.
 */
async function readZipDirectory(zipUrl: string): Promise<{ size: number; members: Record<string, ZipMember> }> {
  const head = await fetch(zipUrl, { method: "HEAD", redirect: "follow" });
  if (!head.ok) throw new Error(`HEAD ${zipUrl} returned HTTP ${head.status}.`);
  const size = Number(head.headers.get("content-length"));
  if (!Number.isFinite(size) || size <= 0) throw new Error("The open-lofi release zip reported no size.");

  const tailLength = Math.min(128 * 1024, size);
  const tail = await getRange(zipUrl, size - tailLength, size - 1);

  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("No end-of-central-directory record in the release zip.");

  const entries = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || entries === 0xffff) {
    throw new Error("The release zip uses ZIP64 records, which this importer does not read.");
  }

  const cd = await getRange(zipUrl, cdOffset, cdOffset + cdSize - 1);
  const members: Record<string, ZipMember> = {};
  let p = 0;
  for (let i = 0; i < entries; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error(`Bad central directory signature at byte ${p}.`);
    const method = cd.readUInt16LE(p + 10);
    const csize = cd.readUInt32LE(p + 20);
    const usize = cd.readUInt32LE(p + 24);
    const nameLength = cd.readUInt16LE(p + 28);
    const extraLength = cd.readUInt16LE(p + 30);
    const commentLength = cd.readUInt16LE(p + 32);
    const localOff = cd.readUInt32LE(p + 42);
    const name = cd.subarray(p + 46, p + 46 + nameLength).toString("utf8");
    members[name] = { method, csize, usize, localOff };
    p += 46 + nameLength + extraLength + commentLength;
  }
  return { size, members };
}

interface LofiCatalog {
  categories: { slug: string; label: string }[];
  tracks: { title: string; filename: string; category: string }[];
}

interface GhTree {
  truncated?: boolean;
  tree: { path: string; type: string; sha: string; size?: number }[];
}

async function buildIndex(): Promise<MusicIndex> {
  const catalog = await getJson<LofiCatalog>(LOFI_CATALOG_URL);
  const release = await getJson<{ assets: { name: string; browser_download_url: string }[] }>(
    `https://api.github.com/repos/${LOFI_REPO}/releases/latest`,
  );
  const asset = release.assets.find((a) => a.name.toLowerCase().endsWith(".zip"));
  if (!asset) throw new Error("The latest open-lofi release has no zip asset to read tracks from.");
  const zipUrl = asset.browser_download_url;
  const { members } = await readZipDirectory(zipUrl);

  const lofiCategories: Record<string, string> = {};
  for (const c of catalog.categories) lofiCategories[c.slug] = c.label;

  const tracks: IndexedTrack[] = [];
  for (const t of catalog.tracks) {
    const member = members[t.filename];
    if (!member) continue; // listed in the catalog but absent from this release
    tracks.push({
      id: `lofi:${t.filename.replace(/\.mp3$/i, "")}`,
      source: "lofi",
      title: t.title,
      category: t.category,
      categoryLabel: lofiCategories[t.category] ?? t.category,
      filename: t.filename,
      bytes: member.usize,
      zip: member,
    });
  }

  // The contents API caps a directory listing at 1000 entries and two of these folders
  // hold several thousand, so each folder's git tree is read instead.
  const root = await getJson<GhTree>(`https://api.github.com/repos/${CC0_REPO}/git/trees/main`);
  for (const folder of root.tree.filter((n) => n.type === "tree")) {
    const tree = await getJson<GhTree>(`https://api.github.com/repos/${CC0_REPO}/git/trees/${folder.sha}`);
    for (const node of tree.tree) {
      if (node.type !== "blob") continue;
      if (!/\.(mp3|wav|ogg|flac|m4a)$/i.test(node.path)) continue;
      tracks.push({
        id: `cc0:${folder.path}/${node.path}`,
        source: "cc0",
        title: node.path.replace(/\.[a-z0-9]+$/i, ""),
        category: folder.path,
        categoryLabel: folder.path,
        filename: node.path,
        bytes: node.size ?? 0,
      });
    }
  }

  return { builtAt: new Date().toISOString(), zipUrl, lofiCategories, tracks };
}

function indexPath(projectRoot: string): string {
  return path.join(projectRoot, "output", "music-index.json");
}

async function loadIndex(projectRoot: string, refresh: boolean): Promise<MusicIndex> {
  const cache = indexPath(projectRoot);
  if (!refresh && fs.existsSync(cache)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cache, "utf8")) as MusicIndex;
      if (parsed.tracks?.length) return parsed;
    } catch {
      // unreadable cache is not worth reporting: rebuild it
    }
  }
  const index = await buildIndex();
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, JSON.stringify(index), "utf8");
  return index;
}

// ── search ────────────────────────────────────────────────────────────────────

function scoreTrack(track: IndexedTrack, needles: string[]): number {
  if (needles.length === 0) return 1;
  const title = track.title.toLowerCase();
  const rest = `${track.categoryLabel} ${track.category}`.toLowerCase();
  let score = 0;
  for (const n of needles) {
    if (title.includes(n)) score += 3;
    else if (rest.includes(n)) score += 1;
  }
  return score;
}

export async function runFindMusicBed(input: FindMusicBedInput): Promise<FindMusicBedResult> {
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const index = await loadIndex(projectRoot, Boolean(input.refresh));

  const wantedSource = input.source && input.source !== "any" ? input.source : undefined;
  const needles = (input.query ?? "")
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);

  const limit = Math.max(1, Math.min(input.limit ?? 15, 100));
  const pool: IndexedTrack[] = [];
  const scored: { track: IndexedTrack; score: number }[] = [];
  for (const track of index.tracks) {
    if (wantedSource && track.source !== wantedSource) continue;
    if (input.category && track.category !== input.category) continue;
    pool.push(track);
    const score = scoreTrack(track, needles);
    if (score > 0) scored.push({ track, score });
  }
  scored.sort((a, b) => b.score - a.score || a.track.title.localeCompare(b.track.title));

  // The corpus carries no genre metadata: a track is a filename in a folder named after
  // the site it came from. So a mood query matches only where the title happens to say it,
  // and coming back empty would be misleading about what is in there. Fall back to a
  // sample of the filtered pool and say that is what happened.
  const fellBack = scored.length === 0 && pool.length > 0;
  const shortlist = fellBack
    ? [...pool].sort((a, b) => a.title.localeCompare(b.title)).map((track) => ({ track, score: 0 }))
    : scored;

  const candidates = shortlist.slice(0, limit).map(({ track }) => ({
    id: track.id,
    title: track.title,
    source: track.source,
    category: track.categoryLabel,
    megabytes: Number((track.bytes / 1e6).toFixed(1)),
    licence: SOURCE_META[track.source].licence,
    sourceRepo: SOURCE_META[track.source].repo,
  }));

  const cc0Folders = [...new Set(index.tracks.filter((t) => t.source === "cc0").map((t) => t.category))];

  return {
    query: input.query ?? "",
    indexedAt: index.builtAt,
    trackCount: index.tracks.length,
    candidates,
    categories: { lofi: index.lofiCategories, cc0: cc0Folders },
    licenceNote:
      "Both catalogs are CC0-1.0: public domain, no attribution owed, commercial use fine. " +
      "open-lofi is one author's own release. The CC0 corpus is community-aggregated and runs on " +
      "takedown requests, so check the originating site for a track whose licence has to be certain.",
    matchedQuery: !fellBack,
    nextStep:
      candidates.length === 0
        ? "Nothing matched and nothing is in scope. Drop source or category and search again."
        : fellBack
          ? `No title matched "${input.query ?? ""}", so this is a plain sample of what is in scope. ` +
            "Corpus tracks carry no genre tags, only filenames, so try a word a composer would put in " +
            "a title, or audition a few of these and import_music_bed the one that fits."
          : `Play a couple before committing, then import_music_bed with the id you want (e.g. "${candidates[0]!.id}").`,
  };
}

// ── import ────────────────────────────────────────────────────────────────────

async function fetchTrackBytes(index: MusicIndex, track: IndexedTrack): Promise<Buffer> {
  if (track.source === "lofi") {
    const member = track.zip;
    if (!member) throw new Error(`Index entry for ${track.id} has no zip offsets. Re-run with refresh true.`);
    const header = await getRange(index.zipUrl, member.localOff, member.localOff + 29);
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    const dataStart = member.localOff + 30 + nameLength + extraLength;
    const data = await getRange(index.zipUrl, dataStart, dataStart + member.csize - 1);
    if (member.method === 0) return data;
    if (member.method === 8) return inflateRawSync(data);
    throw new Error(`Zip member uses compression method ${member.method}, which this importer does not read.`);
  }

  const relative = track.id.slice("cc0:".length);
  const url = `https://raw.githubusercontent.com/${CC0_REPO}/main/${relative
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${url} returned HTTP ${res.status}.`);
  return Buffer.from(await res.arrayBuffer());
}

async function probeDuration(file: string, cwd: string): Promise<number | null> {
  const res = await spawnCapture(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    cwd,
  );
  if (res.code !== 0) return null;
  const value = Number(res.stdout.trim());
  return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}

function writeLedger(dir: string, entry: { file: string; track: IndexedTrack }): string {
  const ledger = path.join(dir, "MUSIC-SOURCES.md");
  const meta = SOURCE_META[entry.track.source];
  const row = `| ${entry.file} | ${entry.track.title} | ${meta.repo} | ${meta.licence} | ${new Date()
    .toISOString()
    .slice(0, 10)} |`;

  if (!fs.existsSync(ledger)) {
    fs.writeFileSync(
      ledger,
      [
        "# Imported music",
        "",
        "Written by import_music_bed. Every track here is CC0-1.0, so none of it needs a credit",
        "line in the video description. The table is provenance, not an attribution requirement:",
        "it is what tells you, later, where a bed came from and under what terms.",
        "",
        "| File | Track | Source | Licence | Imported |",
        "|---|---|---|---|---|",
        row,
        "",
      ].join("\n"),
      "utf8",
    );
    return ledger;
  }

  const body = fs.readFileSync(ledger, "utf8");
  if (body.includes(`| ${entry.file} |`)) return ledger;
  fs.writeFileSync(ledger, `${body.replace(/\n+$/, "")}\n${row}\n`, "utf8");
  return ledger;
}

export async function runImportMusicBed(input: ImportMusicBedInput): Promise<ImportMusicBedResult> {
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const index = await loadIndex(projectRoot, false);

  const exact = index.tracks.find((t) => t.id === input.id);
  const loose = exact
    ? [exact]
    : index.tracks.filter((t) => t.id.toLowerCase().includes(input.id.toLowerCase()));
  if (loose.length === 0) {
    throw new Error(`No track matches "${input.id}". Run find_music_bed first and copy an id from it.`);
  }
  if (loose.length > 1) {
    throw new Error(
      `"${input.id}" matches ${loose.length} tracks, e.g. ${loose
        .slice(0, 3)
        .map((t) => t.id)
        .join(", ")}. Pass a full id.`,
    );
  }
  const track = loose[0]!;

  // sanitizeRelativeOutPath validates and hands the relative path back, so resolve it.
  const relativeOut = sanitizeRelativeOutPath(
    projectRoot,
    input.out ?? `public/imported_audios/${track.filename}`,
    "out",
  );
  const outAbs = path.resolve(projectRoot, relativeOut);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });

  const bytes = await fetchTrackBytes(index, track);

  let processing: string;
  if (input.raw) {
    fs.writeFileSync(outAbs, bytes);
    processing = "none (raw track, as published)";
  } else {
    const temp = path.join(os.tmpdir(), `ovs-music-${process.pid}-${Date.now()}${path.extname(track.filename)}`);
    fs.writeFileSync(temp, bytes);
    try {
      const full = await probeDuration(temp, projectRoot);
      const start = Math.max(0, input.start ?? 0);
      const seconds = input.seconds ?? (full !== null ? Math.max(1, full - start) : 60);
      const fadeIn = input.fadeInSeconds ?? 1.5;
      const fadeOut = input.fadeOutSeconds ?? 2.5;
      const lufs = input.lufs ?? -20;

      if (full !== null && start >= full) {
        throw new Error(`start ${start}s is past the end of "${track.title}" (${full.toFixed(1)}s).`);
      }

      const filters = [
        `afade=t=in:st=0:d=${fadeIn}`,
        `afade=t=out:st=${Math.max(0, seconds - fadeOut)}:d=${fadeOut}`,
        // Single-pass loudnorm: an approximation, but it keeps a bed from arriving 10dB
        // louder than the narration it is meant to sit under.
        `loudnorm=I=${lufs}:TP=-1.5:LRA=11`,
      ].join(",");

      const res = await spawnCapture(
        "ffmpeg",
        [
          "-v", "error", "-y",
          "-ss", String(start),
          "-i", temp,
          "-t", String(seconds),
          "-af", filters,
          "-ac", "2",
          "-ar", "48000",
          "-c:a", "libmp3lame",
          "-q:a", "4",
          outAbs,
        ],
        projectRoot,
      );
      if (res.code !== 0) {
        throw new Error(`ffmpeg could not shape the bed:\n${res.stderr.slice(-800)}`);
      }
      processing = `trimmed ${start}s-${start + seconds}s, ${fadeIn}s/${fadeOut}s fades, normalized to ${lufs} LUFS`;
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }

  const meta = SOURCE_META[track.source];
  const provenance = {
    id: track.id,
    title: track.title,
    category: track.categoryLabel,
    sourceRepo: meta.repo,
    sourceUrl: meta.url,
    licence: meta.licence,
    attributionRequired: false,
    importedAt: new Date().toISOString(),
  };
  const provenanceAbs = `${outAbs}.source.json`;
  fs.writeFileSync(provenanceAbs, JSON.stringify(provenance, null, 2) + "\n", "utf8");
  const ledgerAbs = writeLedger(path.dirname(outAbs), { file: path.basename(outAbs), track });

  const rel = (p: string) => path.relative(projectRoot, p).replace(/\\/g, "/");
  const relFile = rel(outAbs);

  return {
    file: relFile,
    durationSeconds: await probeDuration(outAbs, projectRoot),
    bytes: fs.statSync(outAbs).size,
    track: {
      id: track.id,
      title: track.title,
      category: track.categoryLabel,
      sourceRepo: meta.repo,
      licence: meta.licence,
    },
    processing,
    provenanceFile: rel(provenanceAbs),
    ledgerFile: rel(ledgerAbs),
    licenceNote: "CC0-1.0. No credit line is required in the video description.",
    nextStep:
      relFile === "public/audio/music-bed.mp3" || relFile === "public/audio/pulse-bed.mp3"
        ? "stitch_composition will pick this up as the bed on its next run. Call plan_music_cues on it to cut on the beat."
        : `Call plan_music_cues on ${relFile} for its beat grid, or move it to public/audio/music-bed.mp3 to have stitch_composition attach it automatically.`,
  };
}

// ── registration ──────────────────────────────────────────────────────────────

export function registerMusicLibrary(server: McpServer): void {
  server.registerTool(
    "find_music_bed",
    {
      title: "Search public-domain music catalogs for a background track",
      description:
        "Searches two CC0-1.0 catalogs for a music bed and returns candidate tracks with ids: " +
        "btahir/open-lofi (166 lo-fi tracks in 10 categories, one author, released CC0) and " +
        "SoundSafari/CC0-1.0-Music (~9000 tracks aggregated from freepd, chosic, Free Music Archive, " +
        "freesound and Pixabay, much wider in range and in quality). Both are public domain: no " +
        "attribution owed, commercial use fine, nothing to put in a video description, which is why " +
        "they are offered here while plan_sound_effects still sends you to Pixabay by hand for effects. " +
        "Query with plain mood or scene words (\"calm coding\", \"cinematic build\", \"late night\"); " +
        "titles and categories are what get matched, so a genre word works better than a BPM. The first " +
        "call builds an index (about seven GitHub API calls) and caches it at output/music-index.json, " +
        "so later searches are a local read; pass refresh true after a catalog release. Nothing is " +
        "downloaded by this tool: it returns candidates, and import_music_bed fetches the one you pick. " +
        "The corpus is community-aggregated and runs on takedown requests, so for a track whose licence " +
        "has to be certain, check the originating site, or stay on the open-lofi side.",
      inputSchema: {
        projectRoot: z.string().optional(),
        query: z.string().optional().describe('Mood or scene words, e.g. "calm focus coding".'),
        source: z.enum(["lofi", "cc0", "any"]).optional(),
        category: z
          .string()
          .optional()
          .describe('A lo-fi category slug (e.g. "ambient-lofi") or a corpus folder (e.g. "freepd.com").'),
        limit: z.number().int().positive().optional(),
        refresh: z.boolean().optional(),
      },
    },
    async (input) => runTool("find_music_bed", () => runFindMusicBed(input)),
  );

  server.registerTool(
    "import_music_bed",
    {
      title: "Download a CC0 track and shape it into a music bed",
      description:
        "Downloads one track found by find_music_bed and, unless raw is true, shapes it into a bed: " +
        "trims from start for seconds, applies fade in and out, and normalizes to a target LUFS so it " +
        "sits under narration instead of over it. Writes the file, a <file>.source.json next to it, and " +
        "a MUSIC-SOURCES.md row in the same folder recording track, source repo and licence. Both " +
        "catalogs are CC0-1.0, so that ledger is provenance, not an attribution obligation. The default " +
        "destination is public/imported_audios/, which is the folder that holds anything not from the " +
        "built-in pack; pass out as public/audio/music-bed.mp3 to have stitch_composition attach it as " +
        "the composition's bed automatically. open-lofi publishes its tracks only inside a 554MB release " +
        "zip, so a lo-fi import reads that zip's central directory over HTTP range requests and fetches " +
        "only the few MB belonging to the chosen track; a corpus import is one raw file request. Needs " +
        "ffmpeg on PATH unless raw is true. Call plan_music_cues on the result to cut scenes on its beat.",
      inputSchema: {
        projectRoot: z.string().optional(),
        id: z.string().min(1).describe('A track id from find_music_bed, e.g. "lofi:terminal-rain".'),
        out: z
          .string()
          .optional()
          .describe('Project-relative destination. Defaults to public/imported_audios/<track filename>.'),
        seconds: z.number().positive().optional().describe("Bed length. Defaults to the rest of the track."),
        start: z.number().nonnegative().optional().describe("Seconds into the track to start from."),
        fadeInSeconds: z.number().nonnegative().optional(),
        fadeOutSeconds: z.number().nonnegative().optional(),
        lufs: z.number().optional().describe("Loudness target, default -20 LUFS."),
        raw: z.boolean().optional().describe("Skip trimming and normalization, keep the track as published."),
      },
    },
    async (input) => runTool("import_music_bed", () => runImportMusicBed(input)),
  );
}
