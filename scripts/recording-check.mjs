#!/usr/bin/env node
/**
 * CI check for the recording path: records a local fixture page with capture_screen_recording on
 * whatever OS this runs on, then checks the file the way a viewer would. The recording engine
 * (Playwright's video capture, the webm to mp4 transcode, the ffprobe duration lookup) is the part
 * that differs most between Windows, macOS and Linux and the least covered by the render jobs, which
 * never record anything.
 *
 * Three things have to be true of the mp4 that lands:
 *   resolution    the requested viewport, in real pixels, measured with ffprobe
 *   duration      the length of what was recorded, measured with ffprobe and agreeing with the tool's own
 *   not blank     frames pulled out with ffmpeg have real content, and they change over time (the fixture
 *                 animates), so a recording of a white or frozen page fails here instead of shipping
 *
 * Needs: packages built (capture, mcp-server), ffmpeg + ffprobe on PATH, Playwright's chromium.
 */
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPkg = path.join(root, "packages", "mcp-server");
const requireFromServer = createRequire(path.join(serverPkg, "package.json"));

const WIDTH = 1280;
const HEIGHT = 720;
const WAIT_MS = 2500;

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`${cond ? "  ok  " : "  FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures++;
}
function fail(msg) {
  console.error(`recording-check: ${msg}`);
  process.exit(1);
}

const recordingTool = path.join(serverPkg, "dist", "tools", "captureScreenRecording.js");
if (!fs.existsSync(recordingTool)) fail(`${recordingTool} not found. Run: pnpm --filter @openvidstudio/mcp-server build`);
for (const bin of ["ffmpeg", "ffprobe"]) {
  if (spawnSync(bin, ["-version"], { stdio: "ignore" }).status !== 0) fail(`${bin} is not on PATH`);
}
const sharp = requireFromServer("sharp");
const { runCaptureScreenRecording } = requireFromServer(recordingTool);

// A dark page with a large title and a block that cycles colour, so every frame has content and no two
// frames a second apart are the same.
// OVS_RECORDING_CHECK_BLANK=1 serves a blank page instead. It exists to show the check can fail: a
// recording of nothing has to be reported, so this mode is expected to exit non-zero.
const blank = process.env.OVS_RECORDING_CHECK_BLANK === "1";
const fixture = blank
  ? `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff">`
  : `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#101826;color:#fff;font:700 96px/1 sans-serif}
  h1{position:absolute;left:80px;top:80px;margin:0}
  #block{position:absolute;left:80px;top:260px;width:640px;height:320px;animation:cycle 2s linear infinite}
  @keyframes cycle{0%{background:#e63946}33%{background:#2a9d8f}66%{background:#f4a261}100%{background:#e63946}}
</style><h1>recording check</h1><div id="block"></div>`;
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(fixture);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-recording-check-"));

function probe(file) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name:format=duration", "-of", "json", file],
    { encoding: "utf8" },
  );
  if (r.status !== 0) fail(`ffprobe could not read ${file}: ${r.stderr}`);
  const doc = JSON.parse(r.stdout);
  return { width: doc.streams[0].width, height: doc.streams[0].height, codec: doc.streams[0].codec_name, seconds: Number.parseFloat(doc.format.duration) };
}

/**
 * One frame every STEP seconds across the whole clip, as { t, mean, stdev }. A frame has content when its
 * pixels vary (stdev over 20): the fixture is a dark page with a large title and a coloured block, a
 * blank page is one flat colour.
 */
const STEP = 0.25;
async function sampleFrames(file, seconds) {
  const dir = path.join(projectRoot, "frames");
  fs.mkdirSync(dir, { recursive: true });
  const r = spawnSync("ffmpeg", ["-nostdin", "-y", "-i", file, "-vf", `fps=${1 / STEP},scale=320:-1`, path.join(dir, "f-%03d.png")], { encoding: "utf8" });
  if (r.status !== 0) fail(`could not extract frames: ${r.stderr.slice(-400)}`);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  if (files.length < 3) fail(`only ${files.length} frames came out of a ${seconds.toFixed(1)}s clip`);
  const out = [];
  for (const [i, f] of files.entries()) {
    const st = await sharp(path.join(dir, f)).removeAlpha().stats();
    out.push({ t: i * STEP, mean: st.channels.map((c) => c.mean), stdev: Math.max(...st.channels.map((c) => c.stdev)) });
  }
  return out;
}

try {
  console.log(`recording-check on ${process.platform} (${os.arch()}), node ${process.version}`);
  const started = Date.now();
  const result = await runCaptureScreenRecording({
    projectRoot,
    beatId: "fixture",
    url,
    viewport: { width: WIDTH, height: HEIGHT },
    interactions: [{ type: "wait", ms: WAIT_MS }],
  });
  console.log(`  recorded ${result.outPath} in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  check("the recording file exists and is not empty", fs.existsSync(result.outPath) && fs.statSync(result.outPath).size > 5000, `${fs.statSync(result.outPath).size} bytes`);

  const info = probe(result.outPath);
  check("the video is H.264, which is what OffthreadVideo needs", info.codec === "h264", info.codec);
  check(`resolution: ffprobe measures ${WIDTH}x${HEIGHT}, the requested viewport`, info.width === WIDTH && info.height === HEIGHT, `${info.width}x${info.height}`);
  check("resolution: the tool reports the same size", result.width === WIDTH && result.height === HEIGHT, `${result.width}x${result.height}`);

  // The page was recorded for at least the wait, plus navigation and settle, and the clip cannot be
  // much longer than that on any runner.
  const minSeconds = WAIT_MS / 1000 - 0.3;
  const maxSeconds = 20;
  check(`duration: at least the ${WAIT_MS}ms wait that was recorded`, info.seconds >= minSeconds, `${info.seconds.toFixed(2)}s`);
  check(`duration: under ${maxSeconds}s, so nothing hung`, info.seconds <= maxSeconds, `${info.seconds.toFixed(2)}s`);
  check("duration: the tool's own figure agrees with ffprobe's", typeof result.durationMs === "number" && Math.abs(result.durationMs / 1000 - info.seconds) < 0.3, `${result.durationMs}ms vs ${(info.seconds * 1000).toFixed(0)}ms`);

  // The recording starts when the browser opens the page and the video includes the page loading, so
  // the first moments can be blank and how many depends on the machine (Windows runners are slow to
  // paint). What has to hold everywhere is that the page is then on screen for the whole of what was
  // recorded: at least the wait, with content right up to the end.
  const frames = await sampleFrames(result.outPath, info.seconds);
  const has = (f) => f.stdev > 20;
  const firstContent = frames.findIndex(has);
  const lastContent = frames.length - 1 - [...frames].reverse().findIndex(has);
  check("not blank: the page appears in the recording", firstContent !== -1, `${frames.filter(has).length} of ${frames.length} frames have content`);
  if (firstContent !== -1) {
    const leading = frames[firstContent].t;
    console.log(`  note: the first ${leading.toFixed(2)}s of the recording is the page still loading`);
    const visibleSeconds = (lastContent - firstContent + 1) * STEP;
    check(`not blank: the page is visible for at least the ${WAIT_MS}ms that was recorded`, visibleSeconds >= WAIT_MS / 1000 - 0.3, `${visibleSeconds.toFixed(2)}s visible`);
    check("not blank: it is still on screen at the end of the clip", frames.length - 1 - lastContent <= 1, `last frame with content at ${frames[lastContent].t.toFixed(2)}s of ${info.seconds.toFixed(2)}s`);
    check("not blank: no blank gap in the middle once the page has appeared", frames.slice(firstContent, lastContent + 1).every(has));
    // The block cycles colour, so frames of the page are not all the same picture.
    const shown = frames.slice(firstContent, lastContent + 1);
    const spread = Math.max(...shown.flatMap((a) => shown.map((b) => Math.max(...a.mean.map((m, c) => Math.abs(m - b.mean[c]))))));
    check("not frozen: the frames change over time", spread > 6, `largest mean-colour difference ${spread.toFixed(1)}`);
  }
} finally {
  server.close();
  // Windows can hold the recording open for a moment after the browser closes.
  fs.rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failures > 0) {
  console.error(`recording-check: ${failures} check(s) failed on ${process.platform}`);
  process.exit(1);
}
console.log(`recording-check passed on ${process.platform}`);
