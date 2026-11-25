#!/usr/bin/env node
// capture-multi-viewport: one capture_screenshot call yields every requested viewport, each with its
// own device pixel ratio and a file named for it (#210).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";
import { require, packageRoot, distDir, check, skip, finish } from "./_harness.mjs";

const capture = require(path.join(packageRoot, "..", "capture", "dist", "index.js"));
const { resolveViewports, viewportOutPath, VIEWPORT_PRESETS, launchChromium } = capture;
const sharp = require(path.join(packageRoot, "node_modules", "sharp"));

console.log("\n== multi-viewport: resolving the request ==");
{
  const r = resolveViewports(["desktop", "tablet", "phone"]);
  check("preset names resolve to their own sizes and pixel ratios", r[0].viewport.width === 1920 && r[0].deviceScaleFactor === 1 && r[1].viewport.height === 1194 && r[1].deviceScaleFactor === 2 && r[2].deviceScaleFactor === 3);
  check("...and are named for the preset", r.map((v) => v.name).join() === "desktop,tablet,phone");
  const mixed = resolveViewports([{ width: 1000, height: 700 }, { name: "wide", width: 2560, height: 1440, deviceScaleFactor: 1 }], 2);
  check("an unnamed viewport is named for its size", mixed[0].name === "1000x700");
  check("a viewport without its own pixel ratio gets the call's, one with its own keeps it", mixed[0].deviceScaleFactor === 2 && mixed[1].deviceScaleFactor === 1);
  const fails = (fn) => {
    try {
      fn();
      return null;
    } catch (err) {
      return String(err.message);
    }
  };
  check("two viewports with one name are an error, not an overwrite", /used twice/.test(fails(() => resolveViewports(["phone", { name: "phone", width: 400, height: 800 }])) ?? ""));
  check("a name that cannot be part of a file name is an error", /file name/.test(fails(() => resolveViewports([{ name: "../x", width: 400, height: 800 }])) ?? ""));
  check("an empty list is an error", /empty/.test(fails(() => resolveViewports([])) ?? ""));
  check("an unknown preset is an error naming the real ones", /Presets: desktop/.test(fails(() => resolveViewports(["watch"])) ?? ""));
  check("the viewport name goes before the extension", viewportOutPath("public/images/hook.png", "phone") === "public/images/hook-phone.png");
  check("the presets are the documented sizes", VIEWPORT_PRESETS.desktop.width === 1920 && VIEWPORT_PRESETS.phone.width === 390);
}

console.log("\n== multi-viewport: one call, real browser ==");
let probe = null;
try {
  probe = await launchChromium();
  await probe.close();
} catch (err) {
  skip("real multi-viewport capture", `Chromium is not available: ${err.message}`);
  probe = null;
}

if (probe) {
  const { runCaptureScreenshotViewports, runCaptureScreenshot } = require(path.join(distDir, "tools", "captureScreenshot.js"));
  // The page's colour says which layout it rendered: red wide, green medium, blue narrow. That proves
  // each viewport really laid out at its own width, which a file's pixel size alone does not.
  const page = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>
    html,body{margin:0;height:100%} body{background:#0000ff}
    @media (min-width:600px){body{background:#00ff00}} @media (min-width:1200px){body{background:#ff0000}}
  </style><body>responsive</body>`;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(page);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-multi-viewport-"));

  try {
    const result = await runCaptureScreenshotViewports({ projectRoot: root, beatId: "hook", url, viewports: ["desktop", "tablet", "phone"] });
    check("one call returned one capture per viewport, in request order", result.captures.map((c) => c.name).join() === "desktop,tablet,phone");

    const expected = {
      desktop: { w: 1920, h: 1080, dsf: 1, color: [255, 0, 0] },
      tablet: { w: 834, h: 1194, dsf: 2, color: [0, 255, 0] },
      phone: { w: 390, h: 844, dsf: 3, color: [0, 0, 255] },
    };
    for (const c of result.captures) {
      const e = expected[c.name];
      const file = path.join(root, "public", "images", `hook-${c.name}.png`);
      check(`${c.name}: wrote public/images/hook-${c.name}.png`, c.outPath === file && fs.existsSync(file));
      const meta = await sharp(file).metadata();
      check(`${c.name}: the file is ${e.w * e.dsf}x${e.h * e.dsf} on disk (${e.w}x${e.h} CSS at device scale ${e.dsf})`, meta.width === e.w * e.dsf && meta.height === e.h * e.dsf);
      check(`${c.name}: the result reports its own device scale ${e.dsf} and CSS size`, c.deviceScaleFactor === e.dsf && c.width === e.w && c.height === e.h);
      const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const i = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
      check(`${c.name}: the page laid out at this viewport's width (centre pixel ${[...data.slice(i, i + 3)]})`, [...data.slice(i, i + 3)].every((v, k) => Math.abs(v - e.color[k]) < 4));
      const sidecar = JSON.parse(fs.readFileSync(`${file}.capture.json`, "utf8"));
      check(`${c.name}: its capture sidecar records its own viewport and device scale`, sidecar.viewport.width === e.w && sidecar.deviceScaleFactor === e.dsf);
    }
    check("no file was written under the bare beat name", !fs.existsSync(path.join(root, "public", "images", "hook.png")));

    // A default device scale applies to viewports that do not set their own.
    const mixed = await runCaptureScreenshotViewports({
      projectRoot: root,
      beatId: "mixed",
      url,
      deviceScaleFactor: 1,
      viewports: [{ width: 800, height: 600 }, { name: "retina", width: 800, height: 600, deviceScaleFactor: 2 }],
    });
    const dims = await Promise.all(mixed.captures.map(async (c) => (await sharp(c.outPath).metadata()).width));
    check("the call's deviceScaleFactor is the default, a viewport's own overrides it (800 and 1600 px wide)", dims.join() === "800,1600" && mixed.captures[0].name === "800x600");

    // An outPath is extended per viewport.
    const custom = await runCaptureScreenshotViewports({ projectRoot: root, beatId: "c", url, outPath: path.join("shots", "page.png"), viewports: ["phone"] });
    check("an outPath gets the viewport name before its extension", custom.captures[0].outPath === path.join(root, "shots", "page-phone.png") && fs.existsSync(custom.captures[0].outPath));

    // Bad requests fail before anything is captured.
    const before = fs.readdirSync(path.join(root, "public", "images")).length;
    const refuse = async (input) => {
      try {
        await runCaptureScreenshotViewports({ projectRoot: root, beatId: "bad", url, ...input });
        return null;
      } catch (err) {
        return String(err.message);
      }
    };
    check("viewport and viewports together are refused", /not both/.test((await refuse({ viewport: { width: 800, height: 600 }, viewports: ["phone"] })) ?? ""));
    check("a duplicate name is refused", /used twice/.test((await refuse({ viewports: ["phone", { name: "phone", width: 400, height: 800 }] })) ?? ""));
    check("...and nothing was written by the refused calls", fs.readdirSync(path.join(root, "public", "images")).length === before);

    // The single-viewport path is unchanged.
    const single = await runCaptureScreenshot({ projectRoot: root, beatId: "single", url, viewport: { width: 800, height: 600 } });
    check("a single viewport still writes <beatId>.png at the default device scale", single.outPath === path.join(root, "public", "images", "single.png") && (await sharp(single.outPath).metadata()).width === 1600);
    let misuse = "";
    try {
      await runCaptureScreenshot({ projectRoot: root, beatId: "x", url, viewports: ["phone"] });
    } catch (err) {
      misuse = String(err.message);
    }
    check("runCaptureScreenshot refuses a viewports list rather than ignoring it", /runCaptureScreenshotViewports/.test(misuse));
  } finally {
    server.close();
  }
}

finish();
