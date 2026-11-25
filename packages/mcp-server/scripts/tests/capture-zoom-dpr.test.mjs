#!/usr/bin/env node
// capture-zoom-dpr: before capturing, innerWidth and devicePixelRatio are read and compared with the
// request (#212). A consistent zoom is compensated; anything else fails with a message that says what
// was measured.

import * as path from "node:path";
import * as http from "node:http";
import { require, packageRoot, check, skip, finish } from "./_harness.mjs";

const capture = require(path.join(packageRoot, "..", "capture", "dist", "index.js"));
const { detectAndCompensateZoom, assertViewportBeforeRecording, judgeZoomSignals, judgeCompensatedViewport, ViewportDesyncError, ZoomCompensationError, launchChromium } = capture;

const target = { width: 1600, height: 1000 };

console.log("\n== zoom and devicePixelRatio: pure judgement ==");
{
  const j = (over) => judgeZoomSignals({ target, deviceScaleFactor: 2, innerWidth: 1600, innerHeight: 1000, devicePixelRatio: 2, ...over });
  check("no zoom: innerWidth and devicePixelRatio agree, nothing to report", j({}) === null);
  check("a consistent 0.8 zoom (innerWidth 2000, devicePixelRatio 1.6) is not an error, it is compensated later", j({ innerWidth: 2000, innerHeight: 1250, devicePixelRatio: 1.6 }) === null);
  const dprOnly = j({ devicePixelRatio: 1 });
  check("devicePixelRatio 1 where 2 was requested, with the width untouched, is reported", typeof dprOnly === "string");
  check("...and the message names devicePixelRatio, both readings and both implied zooms", /devicePixelRatio 1\./.test(dprOnly) && /innerWidth 1600/.test(dprOnly) && /1\.000/.test(dprOnly) && /0\.500/.test(dprOnly));
  check("a width that says 0.8 and a ratio that says 1 is reported", typeof j({ innerWidth: 2000, devicePixelRatio: 2 }) === "string");
  check("a 0.5% mismatch is within tolerance", j({ devicePixelRatio: 2.01 }) === null);

  const c = (over) => judgeCompensatedViewport({ target, deviceScaleFactor: 2, zoom: 0.8, innerWidth: 1600, innerHeight: 1000, devicePixelRatio: 1.6, ...over });
  check("a compensated page (innerWidth back on target, ratio at device scale x zoom) is fine", c({}) === null);
  check("a compensated page whose innerWidth is still off is reported", /innerWidth x innerHeight is 2000x1250/.test(c({ innerWidth: 2000, innerHeight: 1250 }) ?? ""));
  check("a compensated page whose ratio fell back to the device scale is reported", /should give 1\.600/.test(c({ devicePixelRatio: 2 }) ?? ""));
  check("...and says the recording was not started", /was not started/.test(c({ devicePixelRatio: 2 }) ?? ""));
}

console.log("\n== zoom and devicePixelRatio: a page that answers canned readings ==");
{
  const fake = (readings) => {
    let i = 0;
    return {
      async setViewportSize() {},
      async evaluate(fn) {
        // detectAndCompensateZoom asks for [w, h], then (with a device scale given) for the ratio.
        const src = String(fn);
        if (src.includes("devicePixelRatio")) return readings.dpr;
        return readings.sizes[Math.min(i++, readings.sizes.length - 1)];
      },
    };
  }
  let error = null;
  try {
    await detectAndCompensateZoom(fake({ sizes: [[1600, 1000]], dpr: 1 }), target, { deviceScaleFactor: 2 });
  } catch (err) {
    error = err;
  }
  check("a DPR-only desync throws ViewportDesyncError before any compensation is attempted", error instanceof ViewportDesyncError);
  check("...carrying the measurements", error?.measured.devicePixelRatio === 1 && error.measured.innerWidth === 1600 && error.deviceScaleFactor === 2);
  const ok = await detectAndCompensateZoom(fake({ sizes: [[1600, 1000]], dpr: 2 }), target, { deviceScaleFactor: 2 });
  check("matching readings pass and report the ratio that was read", ok.zoom === 1 && ok.devicePixelRatio === 2);
  const legacy = await detectAndCompensateZoom(fake({ sizes: [[1600, 1000]], dpr: 99 }), target);
  check("without a device scale the old behaviour is unchanged (no ratio read, no new failure)", legacy.zoom === 1 && legacy.devicePixelRatio === undefined);
  check("ZoomCompensationError is still exported for the non-convergent case", typeof ZoomCompensationError === "function");
}

console.log("\n== zoom and devicePixelRatio: a real browser with a forced zoom origin ==");
let browser = null;
try {
  browser = await launchChromium();
} catch (err) {
  skip("real browser zoom checks", `Chromium is not available: ${err.message}`);
}

if (browser) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><body style='margin:0'><div style='height:2000px'>zoom</div></body>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;

  /**
   * Makes a page behave as if its origin carried a per-origin browser zoom of `z`: the layout viewport
   * is `size / z` and the pixel ratio is `deviceScaleFactor * z`, and both persist across
   * setViewportSize, which is what separates a zoom from a one-off viewport mistake. Chromium's real
   * per-origin zoom lives in the profile and cannot be set on a headless context, so this reproduces
   * what it does to the two readings the check looks at, through the device-metrics override.
   */
  async function forceZoom(page, z, deviceScaleFactor) {
    const cdp = await page.context().newCDPSession(page);
    const apply = (size) =>
      cdp.send("Emulation.setDeviceMetricsOverride", {
        width: Math.round(size.width / z),
        height: Math.round(size.height / z),
        deviceScaleFactor: deviceScaleFactor * z,
        mobile: false,
      });
    page.setViewportSize = apply;
    await apply(target);
  }

  const newPage = async (deviceScaleFactor) => {
    const context = await browser.newContext({ deviceScaleFactor });
    const page = await context.newPage();
    await page.setViewportSize(target);
    return { page, context };
  };

  try {
    {
      const { page, context } = await newPage(2);
      await page.goto(url);
      const r = await detectAndCompensateZoom(page, target, { deviceScaleFactor: 2 });
      check("no zoom, device scale 2: the check passes and read a ratio of 2", r.zoom === 1 && r.devicePixelRatio === 2);
      await assertViewportBeforeRecording(page, r.viewport, { deviceScaleFactor: 2, zoom: r.zoom });
      check("...and the pre-recording check passes on the same page", true);
      await context.close();
    }

    {
      // The forced zoom origin: 0.8, so innerWidth reads 2000 and devicePixelRatio 1.6.
      const { page, context } = await newPage(2);
      await page.goto(url);
      await forceZoom(page, 0.8, 2);
      const reading = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
      check(`the forced zoom origin is real in the page (innerWidth ${reading[0]}, devicePixelRatio ${reading[1 + 1]})`, reading[0] === 2000 && Math.abs(reading[2] - 1.6) < 1e-6);
      const r = await detectAndCompensateZoom(page, target, { deviceScaleFactor: 2 });
      check("a forced 0.8 zoom triggers the check, which reads both signals and compensates", Math.abs(r.zoom - 0.8) < 1e-9 && r.viewport.width === 1280 && Math.abs(r.devicePixelRatio - 1.6) < 1e-6);
      const after = await page.evaluate(() => [innerWidth, innerHeight]);
      check("...and the compensated viewport puts innerWidth back on the request", after[0] === 1600 && after[1] === 1000);
      await assertViewportBeforeRecording(page, target, { deviceScaleFactor: 2, zoom: r.zoom });
      check("...so the pre-recording check passes on the compensated page", true);
      await context.close();
    }

    {
      // Zoom the width reports but the ratio does not: not something a viewport change can fix.
      const { page, context } = await newPage(2);
      await page.goto(url);
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 2000, height: 1250, deviceScaleFactor: 2, mobile: false });
      let error = null;
      try {
        await detectAndCompensateZoom(page, target, { deviceScaleFactor: 2 });
      } catch (err) {
        error = err;
      }
      check("a width that says 0.8 with a ratio still at 2 fails with ViewportDesyncError", error instanceof ViewportDesyncError);
      check("...whose message names both implied zooms", /0\.800/.test(error?.message ?? "") && /1\.000/.test(error?.message ?? ""));
      await context.close();
    }

    {
      // The caller says device scale 2, the page's context really is at 1.
      const { page, context } = await newPage(1);
      await page.goto(url);
      let error = null;
      try {
        await detectAndCompensateZoom(page, target, { deviceScaleFactor: 2 });
      } catch (err) {
        error = err;
      }
      check("a device scale that was not applied (ratio 1, requested 2) fails before capture", error instanceof ViewportDesyncError && /devicePixelRatio 1\./.test(error.message));
      await context.close();
    }

    {
      // The pre-recording check on a page whose ratio does not fit the zoom measured earlier.
      const { page, context } = await newPage(1);
      await page.goto(url);
      let error = null;
      try {
        await assertViewportBeforeRecording(page, target, { deviceScaleFactor: 2, zoom: 1 });
      } catch (err) {
        error = err;
      }
      check("recording is refused on a page whose ratio does not fit, with the reason", error instanceof ViewportDesyncError && /was not started/.test(error.message));
      await context.close();
    }

    // The real tools still work on this machine: the check must not break a normal capture.
    const { runCaptureScreenshot } = require(path.join(packageRoot, "dist", "tools", "captureScreenshot.js"));
    const os = await import("node:os");
    const fs = await import("node:fs");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-zoom-dpr-"));
    const shot = await runCaptureScreenshot({ projectRoot: root, beatId: "z", url, viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 });
    check("capture_screenshot at device scale 2 still passes the check and writes a 1600x1200 file", shot.pixelWidth === 1600 && shot.pixelHeight === 1200 && fs.existsSync(shot.outPath));
    const { runCaptureScreenRecording } = require(path.join(packageRoot, "dist", "tools", "captureScreenRecording.js"));
    const rec = await runCaptureScreenRecording({ projectRoot: root, beatId: "zr", url, viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 });
    check("capture_screen_recording at device scale 2 still passes both checks and writes a video", fs.existsSync(rec.outPath) && fs.statSync(rec.outPath).size > 1000);
  } finally {
    server.close();
    await browser.close();
  }
}

finish();
