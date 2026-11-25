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

async function frameStats(file, atSeconds) {
  const out = path.join(projectRoot, `frame-${atSeconds}.png`);
  const r = spawnSync("ffmpeg", ["-nostdin", "-y", "-ss", String(atSeconds), "-i", file, "-frames:v", "1", out], { encoding: "utf8" });
  if (r.status !== 0 || !fs.existsSync(out)) fail(`could not extract a frame at ${atSeconds}s: ${r.stderr.slice(-400)}`);
  const st = await sharp(out).removeAlpha().stats();
  const mean = st.channels.map((c) => c.mean);
  const stdev = Math.max(...st.channels.map((c) => c.stdev));
  return { mean, stdev };
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

  // Frames well inside the clip, away from the first moment before the page paints.
  const times = [0.6, 1.2, Math.min(1.9, info.seconds - 0.3)];
  const stats = [];
  for (const t of times) stats.push(await frameStats(result.outPath, t));
  stats.forEach((s, i) => check(`not blank: the frame at ${times[i]}s has content`, s.stdev > 20, `stdev ${s.stdev.toFixed(1)}`));
  // The block cycles colour, so the frames are not the same picture.
  const spread = Math.max(...[0, 1, 2].flatMap((a) => [0, 1, 2].map((b) => Math.max(...stats[a].mean.map((m, c) => Math.abs(m - stats[b].mean[c]))))));
  check("not frozen: the frames change over time", spread > 6, `largest mean-colour difference ${spread.toFixed(1)}`);
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
