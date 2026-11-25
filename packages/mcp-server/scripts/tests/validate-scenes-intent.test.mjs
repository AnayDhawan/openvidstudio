#!/usr/bin/env node
// validate-scenes-intent: validate_scenes with intent: true opens each browser-captured beat's page again
// and checks it still is what the beat says (#214): a page that changed fails the beat, naming the selector.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";
import { require, packageRoot, distDir, check, skip, finish } from "./_harness.mjs";

const { launchChromium } = require(path.join(packageRoot, "..", "capture", "dist", "index.js"));
const intentMod = require(path.join(distDir, "tools", "validateScenesIntent.js"));
const { validateBeatsLogic } = require(path.join(distDir, "tools", "validateBeats.js"));

console.log("\n== intent: the pure parts ==");
{
  const { normalizeUrl, intentSkipReason, interactionSelectors } = intentMod;
  check("a trailing slash and a hash do not make a different url", normalizeUrl("http://x.test/app/#top") === normalizeUrl("http://x.test/app") && normalizeUrl("http://x.test/") === "http://x.test");
  check("a different path is a different url", normalizeUrl("http://x.test/a") !== normalizeUrl("http://x.test/b"));
  const shot = (visual) => ({ id: "b", visual });
  check("a dom-demo beat has no page to check", /not a browser capture/.test(intentSkipReason(shot({ captureMethod: "dom-demo" }), undefined)));
  check("a desktop recording has no page to check", /not a browser page/.test(intentSkipReason(shot({ captureMethod: "recording", source: "desktop" }), undefined)));
  check("a beat the brief calls constructed is skipped, with the brief named", /brief.*constructed/.test(intentSkipReason(shot({ captureMethod: "screenshot" }), false)));
  check("a browser screenshot beat is checked", intentSkipReason(shot({ captureMethod: "screenshot" }), true) === null && intentSkipReason(shot({ captureMethod: "recording" }), undefined) === null);
  const sels = interactionSelectors([{ type: "click", selector: "#a" }, { type: "wait", ms: 100 }, { type: "scroll", y: 10 }, { type: "fill", selector: "#b", value: "x" }, { type: "scroll", selector: "#panel", y: 5 }]);
  check("the selectors of a click path come with their step index", JSON.stringify(sels) === JSON.stringify([{ index: 0, selector: "#a" }, { index: 3, selector: "#b" }, { index: 4, selector: "#panel" }]));
}

console.log("\n== intent: validate_beats accepts visual.shows ==");
{
  const beat = (shows) => ({
    fps: 30,
    narration: "none",
    beats: [{ id: "a", start: 0, duration: 90, visual: { captureMethod: "screenshot", url: "http://x", interactions: [], ...(shows === undefined ? {} : { shows }) } }],
  });
  const bad = (r) => r.errors.some((e) => /visual\.shows/.test(e));
  check("a list of selectors is accepted", !bad(validateBeatsLogic(beat(["#cart", ".total"]))));
  check("no shows at all is accepted", !bad(validateBeatsLogic(beat(undefined))));
  check("an empty list is refused", bad(validateBeatsLogic(beat([]))));
  check("a non-string entry is refused", bad(validateBeatsLogic(beat([42]))));
  check("a blank selector is refused", bad(validateBeatsLogic(beat([""]))));
}

console.log("\n== intent: against a live page that changes ==");
let probe = null;
try {
  probe = await launchChromium();
  await probe.close();
} catch (err) {
  skip("real intent checks", `Chromium is not available: ${err.message}`);
  probe = null;
}

if (probe) {
  const { runCaptureScreenshot } = require(path.join(distDir, "tools", "captureScreenshot.js"));
  const { runValidateScenesFull } = require(path.join(distDir, "tools", "validateScenes.js"));
  const { runInitProject } = require(path.join(distDir, "tools", "initProject.js"));

  let version = 1;
  const pages = {
    1: `<button id="buy" onclick="document.getElementById('cart').style.display='block'">Buy</button><div id="cart" style="display:none">Cart</div>`,
    2: `<button id="purchase" onclick="document.getElementById('cart').style.display='block'">Buy</button><div id="cart" style="display:none">Cart</div>`,
    3: `<button id="buy">Buy</button><p>The cart panel was removed from this page.</p>`,
  };
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(req.url === "/stable" ? `<h1 id="stable-panel">Stable</h1>` : `<!doctype html>${pages[version]}`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-intent-"));
  for (let attempt = 1; ; attempt++) {
    try {
      runInitProject({ name: "intent", projectRoot: root });
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      fs.rmSync(root, { recursive: true, force: true });
      fs.mkdirSync(root, { recursive: true });
    }
  }
  const videoDir = path.join(root, "src", "videos", "intent");
  fs.mkdirSync(videoDir, { recursive: true });
  const buyClick = [{ type: "click", selector: "#buy" }];
  const writeBeats = (beats) => fs.writeFileSync(path.join(videoDir, "beats.json"), JSON.stringify({ fps: 30, narration: "none", beats: beats.map((b, i) => ({ start: i * 90, duration: 90, ...b })) }));
  const beats = [
    { id: "buy", visual: { captureMethod: "screenshot", url: `${base}/`, interactions: buyClick, shows: ["#cart"] } },
    { id: "stable", visual: { captureMethod: "screenshot", url: `${base}/stable`, interactions: [], shows: ["#stable-panel"] } },
    { id: "built", visual: { captureMethod: "dom-demo" } },
  ];
  writeBeats(beats);

  try {
    // Captured while the page is as the beat describes it.
    await runCaptureScreenshot({ projectRoot: root, beatId: "buy", url: `${base}/`, interactions: buyClick, viewport: { width: 800, height: 600 } });
    await runCaptureScreenshot({ projectRoot: root, beatId: "stable", url: `${base}/stable`, viewport: { width: 800, height: 600 } });
    const run = (extra = {}) => runValidateScenesFull({ projectRoot: root, videoName: "intent", intent: true, ...extra });
    const intentFindings = (r) => r.findings.filter((f) => f.source === "intent");

    // 1. Unchanged.
    const ok = await run();
    check("an unchanged page: no intent findings, nothing drifted", intentFindings(ok).length === 0 && ok.intent.drifted.length === 0);
    check("...both browser beats were checked and the constructed one was skipped with its reason", ok.intent.beatsChecked === 2 && ok.intent.beats.find((b) => b.beatId === "built").status === "skipped" && /not a browser capture/.test(ok.intent.beats.find((b) => b.beatId === "built").reason));
    check("...and each beat is reported by itself", ok.intent.beats.map((b) => `${b.beatId}:${b.status}`).join() === "buy:ok,stable:ok,built:skipped");

    // 2. The button the path clicks was renamed.
    version = 2;
    const renamed = await run();
    const f2 = intentFindings(renamed).filter((f) => f.severity === "error");
    check("a renamed button fails the beat, and the finding names the missing selector #buy", f2.length === 1 && f2[0].beatId === "buy" && f2[0].message.includes("`#buy`"));
    check("...naming the step and the page", /Step 1/.test(f2[0].message) && f2[0].message.includes(`${base}/`));
    check("...the result is not ok and lists only that beat as drifted", renamed.ok === false && renamed.intent.drifted.join() === "buy");
    const buyResult = renamed.intent.beats.find((b) => b.beatId === "buy");
    check("...with the missing selector and the failed step as data", buyResult.missingSelectors.join() === "#buy" && buyResult.failedStep.index === 0 && buyResult.failedStep.selector === "#buy");
    check("...while the beat on the unchanged page is still fine", renamed.intent.beats.find((b) => b.beatId === "stable").status === "ok");

    // 3. The click works, but the panel the beat shows is gone.
    version = 3;
    const gone = await run();
    const f3 = intentFindings(gone).filter((f) => f.severity === "error");
    check("a panel the beat says it shows, gone from the page, is named (#cart)", f3.length === 1 && f3[0].message.includes("`#cart`") && /visual\.shows/.test(f3[0].message));
    check("...as drift with the selector recorded", gone.intent.beats.find((b) => b.beatId === "buy").missingSelectors.join() === "#cart" && gone.ok === false);

    // 4. beats.json and the capture are about different pages.
    version = 1;
    writeBeats([{ ...beats[0], visual: { ...beats[0].visual, url: `${base}/pricing` } }, beats[1]]);
    const moved = await run({ beatIds: ["buy"] });
    const f4 = intentFindings(moved).find((f) => /different page/.test(f.message));
    check("a beat whose url no longer matches the one its capture was taken of is an error naming both urls", !!f4 && f4.message.includes(`${base}/pricing`) && f4.message.includes(`${base}/`));
    check("...and beatIds limits the check to that beat", moved.intent.beats.length === 1);

    // 5. A selector that is hidden is not on screen.
    writeBeats(beats);
    pages[1] = `<button id="buy" onclick="document.getElementById('cart').style.display='block'">Buy</button><div id="cart" style="display:none">Cart</div>`;
    const hiddenBeats = [{ ...beats[0], visual: { ...beats[0].visual, interactions: [], shows: ["#cart"] } }];
    writeBeats(hiddenBeats);
    const hidden = await run({ beatIds: ["buy"] });
    check("a selector that exists but is hidden counts as not shown", intentFindings(hidden).some((f) => f.severity === "error" && f.message.includes("`#cart`")));

    // 6. The brief can say a beat is constructed.
    writeBeats(beats);
    fs.writeFileSync(path.join(videoDir, "brief.json"), JSON.stringify({ shotList: [{ beatId: "buy", real: false, provenance: "built by hand", whyConstructed: "no real page", focalPoint: "x" }] }));
    version = 2;
    const briefed = await run();
    check("a beat the brief's shot list marks constructed is skipped, with the brief as the reason, even though its page changed", briefed.intent.beats.find((b) => b.beatId === "buy").status === "skipped" && /brief/.test(briefed.intent.beats.find((b) => b.beatId === "buy").reason));
    fs.rmSync(path.join(videoDir, "brief.json"));

    // 7. Without the flag nothing opens a browser.
    const plain = await runValidateScenesFull({ projectRoot: root, videoName: "intent" });
    check("without intent: true there is no intent block and no intent findings", plain.intent === undefined && intentFindings(plain).length === 0);

    // 8. A page that cannot be opened is skipped, not drift.
    version = 1;
    await new Promise((resolve) => server.close(resolve));
    const down = await run({ beatIds: ["stable"] });
    const skipped = intentFindings(down);
    check("a product that is not running is intent-skipped with a warning, not reported as drift", down.intent.drifted.length === 0 && skipped.length === 1 && skipped[0].severity === "warning" && skipped[0].check === "intent-skipped");
    check("...and says which url could not be opened", skipped[0].message.includes(`${base}/stable`));
  } finally {
    server.close();
  }
}

finish();
