import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition, type HeadlessBrowser } from "@remotion/renderer";
import { chromium, type Page } from "playwright";

/**
 * Shared Remotion SSR plumbing for render_stills and validate_scenes's render mode.
 *
 * Both tools need the same expensive-if-repeated step: bundle the project once. A full
 * `remotion render`/`remotion still` CLI invocation re-bundles on every single call (see
 * reference/scripts/stills.mjs's own comment on this), which is the slow part a QC loop
 * can't afford. Everything below is built on @remotion/bundler + @remotion/renderer's
 * public, documented SSR API (bundle -> selectComposition -> renderStill), pinned in this
 * package's package.json to the exact version templates/default's @remotion/cli uses
 * (4.0.524) so the bundler/renderer this package drives never drifts from the version the
 * scaffolded project's compositions were authored against.
 */

export type ResolvedComposition = Awaited<ReturnType<typeof selectComposition>>;

/**
 * Playwright already has to download a Chromium build for every capture tool in this
 * monorepo (see @openvidstudio/capture's launchChromium, used by capture_screenshot etc.),
 * and preflight checks for exactly that build. Pointing @remotion/renderer at that same
 * binary means render_stills/validate_scenes never trigger a second, separate ~300MB
 * browser download through Remotion's own browser-acquisition path, and never need a
 * hardcoded platform-specific path: the reference technique this was ported from
 * (reference/scripts/stills.mjs) hardcoded a Linux chromium_headless_shell path, which
 * does not exist on this project's Windows dev environment or any other platform.
 */
export function resolveBrowserExecutable(): string {
  return chromium.executablePath();
}

/** Resolves the scaffolded project's Remotion entry point, same file init_project writes. */
export function resolveEntryPoint(projectRoot: string): string {
  const entryPoint = path.join(projectRoot, "src", "index.ts");
  if (!fs.existsSync(entryPoint)) {
    throw new Error(
      `No entry point at ${entryPoint}. Is this an openvidstudio project (run init_project first)?`,
    );
  }
  return entryPoint;
}

/**
 * Bundles the project exactly once. The returned string is a local directory, not a URL
 * (that's `@remotion/bundler`'s real return shape) -- `selectComposition`/`renderStill`
 * both accept that directly and spin up their own ephemeral static server per call, which
 * is a cheap, acceptable cost next to the webpack bundle step this function is what avoids
 * repeating.
 */
export async function bundleProject(projectRoot: string): Promise<string> {
  const entryPoint = resolveEntryPoint(projectRoot);
  return bundle({ entryPoint, onProgress: () => undefined });
}

export async function openRenderBrowser(): Promise<HeadlessBrowser> {
  return openBrowser("chrome", { browserExecutable: resolveBrowserExecutable() });
}

export async function resolveComposition(
  serveUrl: string,
  compositionId: string,
  browser: HeadlessBrowser,
): Promise<ResolvedComposition> {
  return selectComposition({ serveUrl, id: compositionId, puppeteerInstance: browser });
}

export interface StillResult {
  outPath: string;
  /** Real pixel dimensions of the file actually written, measured from the file, not assumed. */
  width: number;
  height: number;
  bytes: number;
}

/**
 * Renders one frame to a PNG on disk, reusing an already-open browser and an
 * already-bundled serveUrl. This is the per-still call `render_stills` loops over; the
 * bundle-once speedup comes from calling `bundleProject`/`openRenderBrowser` exactly once
 * per tool call and passing their results into this function many times, never from
 * anything inside this function itself.
 */
export async function renderStillPng(opts: {
  serveUrl: string;
  composition: ResolvedComposition;
  frame: number;
  outPath: string;
  browser: HeadlessBrowser;
  scale?: number;
}): Promise<StillResult> {
  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
  await renderStill({
    serveUrl: opts.serveUrl,
    composition: opts.composition,
    frame: opts.frame,
    output: opts.outPath,
    imageFormat: "png",
    puppeteerInstance: opts.browser,
    scale: opts.scale ?? 1,
  });
  const stat = fs.statSync(opts.outPath);
  // Real on-disk dimensions rather than composition.width/height, which would be wrong
  // the moment `scale` is not 1.
  const dims = readPngDimensions(opts.outPath);
  return { outPath: opts.outPath, width: dims.width, height: dims.height, bytes: stat.size };
}

/**
 * Minimal PNG header reader (no sharp dependency needed for this): width/height live at a
 * fixed byte offset in every PNG's IHDR chunk, which is always the first chunk.
 */
function readPngDimensions(filePath: string): { width: number; height: number } {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------------------------------
// Inspection bridge: a live, seekable Playwright page over the same bundle, for
// validate_scenes's render mode. render_stills never uses any of this -- it only needs
// pixels on disk, which renderStillPng above gets from the public API.
// ---------------------------------------------------------------------------------------

/**
 * Serves a `bundle()` output directory over plain local HTTP so a Playwright page can
 * navigate to it. `@remotion/renderer` has an internal equivalent (`prepareServer`/
 * `serveStatic`) that `selectComposition`/`renderStill` use, but it is not exported from
 * the package's public barrel, and it also wires up an offthread-video proxy and audio
 * compositor this inspection path does not need (see `openSeekablePage`'s doc comment on
 * the OffthreadVideo gap). A static file server is the entire requirement: `bundle()`'s
 * output is plain HTML/JS/CSS/fonts/images, with the project's own `public/` already
 * copied in.
 */
export async function serveBundleDirectory(
  bundleDir: string,
): Promise<{ url: string; close: () => Promise<void> }> {
  const contentTypes: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".webm": "video/webm",
  };

  const server = http.createServer((req, res) => {
    try {
      const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      let rel = decodeURIComponent(reqUrl.pathname);
      if (rel === "/" || rel === "") rel = "/index.html";
      const resolved = path.join(bundleDir, rel);
      // Refuse to serve outside the bundle directory (a malformed/hostile request path).
      if (!resolved.startsWith(path.resolve(bundleDir))) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
        res.writeHead(404);
        res.end();
        return;
      }
      const ext = path.extname(resolved).toLowerCase();
      res.writeHead(200, { "Content-Type": contentTypes[ext] ?? "application/octet-stream" });
      fs.createReadStream(resolved).pipe(res);
    } catch (err) {
      res.writeHead(500);
      res.end(String(err instanceof Error ? err.message : err));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}/index.html`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * Bundle-format version `@remotion/renderer` 4.0.524 requires (see its real
 * set-props-and-env.js: it throws "Incompatible site" when window.siteVersion does not
 * equal this). Not the npm package semver -- Remotion bumps this independently when the
 * generated bundle's contract changes. Only used here as a sanity check before trusting
 * the rest of the hand-rolled protocol below; since this package bundles the project
 * itself with the exact @remotion/bundler version pinned alongside @remotion/renderer,
 * this should always match in practice.
 */
const REQUIRED_SITE_VERSION = "11";

export class RemotionBridgeProtocolError extends Error {
  constructor(message: string) {
    super(
      `${message} This project's render-based inspection relies on @remotion/renderer's internal bundle-seek ` +
        "protocol (window.remotion_*), verified against the installed @remotion/renderer@4.0.524 source, not " +
        "a published API. If @remotion/bundler or @remotion/renderer were upgraded in packages/mcp-server/" +
        "package.json, re-verify this protocol against the new version's dist/{make-page,seek-to-frame,set-" +
        "props-and-env}.js before trusting its output again.",
    );
    this.name = "RemotionBridgeProtocolError";
  }
}

/**
 * A live, seekable Playwright page mounted on a specific composition, for validate_scenes'
 * render mode to run page.evaluate() DOM measurements against. Driven by Playwright
 * directly (not @remotion/renderer's own browser abstraction, which does not expose a
 * public screenshot/waitForFunction surface on its internal Page class), reusing
 * @openvidstudio/capture's launchChromium so this inspection path shares the same browser
 * story as every capture_* tool.
 *
 * `@remotion/renderer`'s renderStill()/selectComposition() never hand back the page they
 * use internally, so there is no published API for "mount this composition and let me run
 * my own page.evaluate() against a specific frame's real DOM." This instead reimplements
 * the minimum of the package's own internal mount/seek contract, verified by reading its
 * real installed source (not guessed from memory) at:
 *   node_modules/.pnpm/@remotion+renderer@4.0.524 (dot star) /node_modules/@remotion/renderer/dist/
 *     {set-props-and-env,make-page,seek-to-frame}.js
 * The sequence:
 *   1. before navigation, set the window globals the bundle's boot code reads
 *      (window.remotion_puppeteerTimeout/isMainTab/mediaCacheSizeInBytes/
 *      initialMemoryAvailable/sampleRate/inputProps/initialFrame/attempt/proxyPort/
 *      audioEnabled/videoEnabled/logLevel, plus a BroadcastChannel and NODE_ENV) --
 *      see set-props-and-env.js
 *   2. navigate to the bundle's (locally served) URL
 *   3. call window.remotion_setBundleMode({type: "composition", ...}) with the metadata
 *      selectComposition already resolved for us -- see make-page.js
 *   4. wait for window.remotion_renderReady, then on every seek call
 *      window.remotion_setFrame(frame, compositionId, attempt) and wait again, then wait
 *      for document.fonts.ready -- see seek-to-frame.js
 *
 * This is Remotion's internal contract, not a published one, so every hook is
 * feature-detected before use: a future @remotion/renderer upgrade that renames or
 * restructures this protocol fails loudly (RemotionBridgeProtocolError) rather than
 * silently measuring whatever a half-mounted page happens to contain.
 *
 * Known gap: a beat using OffthreadVideo (a real screen recording, source: "recording")
 * needs the proxy server renderStill's internals set up for it (@remotion/renderer's
 * prepareServer, not exported publicly). This bridge does not start one, so such a beat's
 * video layer will fail to decode and remotion_renderReady will never flip back to true;
 * callers should catch the resulting timeout and report that beat's render-based checks
 * as skipped with the reason stated, never silently treat a timed-out page as "no findings".
 */
export async function openSeekablePage(opts: {
  page: Page;
  bundleUrl: string;
  composition: ResolvedComposition;
  timeoutMs?: number;
}): Promise<void> {
  const { page, bundleUrl, composition } = opts;
  const timeoutMs = opts.timeoutMs ?? 20000;

  await page.addInitScript(
    ({ timeoutMs: t }: { timeoutMs: number }) => {
      const w = window as unknown as Record<string, unknown>;
      w.remotion_puppeteerTimeout = t;
      w.remotion_isMainTab = true;
      w.remotion_mediaCacheSizeInBytes = null;
      w.remotion_initialMemoryAvailable = null;
      w.remotion_sampleRate = 48000;
      w.remotion_inputProps = "{}";
      w.remotion_initialFrame = 0;
      w.remotion_attempt = 1;
      w.remotion_proxyPort = null;
      w.remotion_audioEnabled = false;
      w.remotion_videoEnabled = true;
      w.remotion_logLevel = "error";
      try {
        w.remotion_broadcastChannel = new BroadcastChannel("remotion-video-frame-extraction");
      } catch {
        // Not available in every context; Remotion's own boot code tolerates its absence.
      }
      const proc = (w.process ?? {}) as { env?: Record<string, string> };
      proc.env = { ...(proc.env ?? {}), NODE_ENV: "production" };
      w.process = proc;
    },
    { timeoutMs },
  );

  await page.goto(bundleUrl, { waitUntil: "load", timeout: timeoutMs });

  const siteVersion = await page.evaluate(() => (window as unknown as { siteVersion?: string }).siteVersion);
  if (siteVersion !== REQUIRED_SITE_VERSION) {
    throw new RemotionBridgeProtocolError(
      `Bundle at ${bundleUrl} reports siteVersion "${String(siteVersion)}", expected "${REQUIRED_SITE_VERSION}". ` +
        "@remotion/renderer itself refuses to drive a mismatched bundle format for the same reason.",
    );
  }

  const hasHooks = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return typeof w.remotion_setBundleMode === "function";
  });
  if (!hasHooks) {
    throw new RemotionBridgeProtocolError(`Bundle at ${bundleUrl} did not expose window.remotion_setBundleMode after load.`);
  }

  await page.evaluate(
    (c) => {
      (window as unknown as { remotion_setBundleMode: (mode: unknown) => void }).remotion_setBundleMode({
        type: "composition",
        compositionName: c.id,
        serializedResolvedPropsWithSchema: "{}",
        compositionDurationInFrames: c.durationInFrames,
        compositionFps: c.fps,
        compositionHeight: c.height,
        compositionWidth: c.width,
        compositionDefaultCodec: c.defaultCodec ?? null,
        compositionDefaultOutName: c.defaultOutName ?? null,
        compositionDefaultVideoImageFormat: c.defaultVideoImageFormat ?? null,
        compositionDefaultPixelFormat: c.defaultPixelFormat ?? null,
        compositionDefaultProResProfile: c.defaultProResProfile ?? null,
        compositionDefaultSampleRate: c.defaultSampleRate ?? null,
      });
    },
    {
      id: composition.id,
      durationInFrames: composition.durationInFrames,
      fps: composition.fps,
      height: composition.height,
      width: composition.width,
      defaultCodec: (composition as unknown as { defaultCodec?: string }).defaultCodec,
      defaultOutName: (composition as unknown as { defaultOutName?: string }).defaultOutName,
      defaultVideoImageFormat: (composition as unknown as { defaultVideoImageFormat?: string })
        .defaultVideoImageFormat,
      defaultPixelFormat: (composition as unknown as { defaultPixelFormat?: string }).defaultPixelFormat,
      defaultProResProfile: (composition as unknown as { defaultProResProfile?: number }).defaultProResProfile,
      defaultSampleRate: (composition as unknown as { defaultSampleRate?: number }).defaultSampleRate,
    },
  );

  // remotion_setFrame is registered by the composition once bundle mode is set, not at load,
  // so it can only be feature-detected here.
  await page
    .waitForFunction(
      () => typeof (window as unknown as Record<string, unknown>).remotion_setFrame === "function",
      undefined,
      { timeout: timeoutMs },
    )
    .catch(() => {
      throw new RemotionBridgeProtocolError(
        `Bundle at ${bundleUrl} did not expose window.remotion_setFrame after remotion_setBundleMode.`,
      );
    });
  await waitForRenderReady(page, timeoutMs);
}

async function waitForRenderReady(page: Page, timeoutMs: number): Promise<void> {
  try {
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).remotion_renderReady === true,
      undefined,
      { timeout: timeoutMs },
    );
  } catch (err) {
    throw new RemotionBridgeProtocolError(
      `Timed out after ${timeoutMs}ms waiting for window.remotion_renderReady. Original: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Moves the already-mounted composition's live playhead to `frame` (a global frame number
 * against the whole stitched composition, same numbering render_stills/contact_sheet use)
 * without a page reload, then waits for the new frame to finish rendering and for webfonts
 * to settle. Safe to call repeatedly against the same page for many sample frames across
 * many beats.
 */
export async function seekToFrame(page: Page, compositionId: string, frame: number, timeoutMs = 20000): Promise<void> {
  await page.evaluate(
    ({ f, c, a }: { f: number; c: string; a: number }) => {
      (window as unknown as { remotion_setFrame: (f: number, c: string, a: number) => void }).remotion_setFrame(
        f,
        c,
        a,
      );
    },
    { f: frame, c: compositionId, a: 1 },
  );
  await waitForRenderReady(page, timeoutMs);
  await page.evaluate(() => document.fonts.ready);
}
