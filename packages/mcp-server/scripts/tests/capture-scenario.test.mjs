#!/usr/bin/env node
// capture-scenario: a click path as a file (JSON or YAML) that compiles to the interactions array the
// capture tools already run (#211).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";
import { require, packageRoot, distDir, check, skip, finish } from "./_harness.mjs";

const capture = require(path.join(packageRoot, "..", "capture", "dist", "index.js"));
const { parseScenario, compileScenario, scenarioFromInteractions, interactionSchema, launchChromium } = capture;
const { validateBeatsLogic } = require(path.join(distDir, "tools", "validateBeats.js"));

// Key order is not part of what an interaction is.
const stable = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

const fails = (fn) => {
  try {
    fn();
    return null;
  } catch (err) {
    return String(err.message);
  }
};

console.log("\n== scenario: JSON and YAML read the same, and compile to interactions ==");
{
  const yamlText = `
name: checkout
url: http://localhost:3000
steps:
  - action: navigate
    url: /pricing
  - action: click
    selector: "#buy"
    settleMs: 1500
  - action: type
    selector: "#email"
    text: a@b.co
  - action: select
    selector: "#plan"
    value: pro
  - action: hover
    selector: .card
  - action: scroll
    y: 800
    durationMs: 600
  - action: wait
    selector: .done
    ms: 4000
  - action: wait
    ms: 250
  - action: settle
`;
  const fromYaml = parseScenario(yamlText, "checkout.yaml");
  const fromJson = parseScenario(JSON.stringify(fromYaml), "checkout.json");
  check("a YAML scenario and the same scenario as JSON parse to the same thing", JSON.stringify(fromYaml) === JSON.stringify(fromJson));
  check("the format is detected from the content when there is no extension", JSON.stringify(parseScenario(JSON.stringify(fromYaml))) === JSON.stringify(fromYaml) && JSON.stringify(parseScenario(yamlText)) === JSON.stringify(fromYaml));

  const compiled = compileScenario(fromYaml);
  check("the starting url comes through", compiled.url === "http://localhost:3000");
  check(
    "every step compiles to the interaction the tools already run (type becomes fill, settleMs becomes a settle after the step)",
    JSON.stringify(compiled.interactions) ===
      JSON.stringify([
        { type: "navigate", url: "/pricing" },
        { type: "click", selector: "#buy" },
        { type: "settle", ms: 1500 },
        { type: "fill", selector: "#email", value: "a@b.co" },
        { type: "select", selector: "#plan", value: "pro" },
        { type: "hover", selector: ".card" },
        { type: "scroll", y: 800, durationMs: 600 },
        { type: "wait", ms: 4000, selector: ".done" },
        { type: "wait", ms: 250 },
        { type: "settle" },
      ]),
  );
  check("every compiled interaction passes the schema the tools enforce", compiled.interactions.every((i) => interactionSchema.safeParse(i).success));
  check("a scenario with no steps is valid and compiles to nothing", compileScenario(parseScenario('{"steps":[]}')).interactions.length === 0);
}

console.log("\n== scenario: mistakes name the step and the field ==");
{
  const bad = (text, file) => fails(() => parseScenario(text, file)) ?? "";
  check("an unknown action names its step", /steps\.0\.action/.test(bad('{"steps":[{"action":"drag","selector":"#a"}]}')));
  check("a click with no selector names the step and field", /steps\.1\.selector/.test(bad('{"steps":[{"action":"settle"},{"action":"click"}]}')));
  check("a negative settle budget is refused", /steps\.0\.settleMs/.test(bad('{"steps":[{"action":"click","selector":"#a","settleMs":-5}]}')));
  check("no steps key is refused", /steps/.test(bad('{"url":"http://x"}')));
  check("broken JSON says it is not valid JSON, and which file", /scenarios\/x\.json is not valid JSON/.test(bad("{nope", "scenarios/x.json")));
  check("broken YAML says it is not valid YAML", /not valid YAML/.test(bad("steps: [\n  - : :", "x.yaml")));
}

console.log("\n== scenario: existing interactions arrays keep working ==");
{
  const arrays = [
    [],
    [{ type: "click", selector: "#a" }],
    [{ type: "click", selector: "#a" }, { type: "settle", ms: 800 }, { type: "fill", selector: "#b", value: "hello" }],
    [{ type: "settle" }, { type: "wait", ms: 300 }, { type: "hover", selector: ".x" }, { type: "settle", ms: 100 }, { type: "settle", ms: 200 }],
    [
      { type: "navigate", url: "/two" },
      { type: "select", selector: "#s", value: "v" },
      { type: "scroll", selector: "#panel", x: 0, y: 400, durationMs: 500 },
      { type: "scroll", y: 100 },
      { type: "wait", selector: ".ready", ms: 2000 },
    ],
  ];
  arrays.forEach((arr, i) => {
    const back = compileScenario(scenarioFromInteractions(arr)).interactions;
    check(`interactions array ${i + 1} (${arr.length} steps) survives a round trip through a scenario unchanged`, stable(back) === stable(arr));
  });
  const asFile = scenarioFromInteractions(arrays[2], "http://localhost:3000");
  check("a settle with a budget after a step folds into that step's settleMs", asFile.steps[0].settleMs === 800 && asFile.steps.length === 2 && asFile.url === "http://localhost:3000");

  const beat = (interactions) => ({
    fps: 30,
    beats: [{ id: "a", start: 0, duration: 90, vo: "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen.", visual: { captureMethod: "screenshot", url: "http://x", interactions } }],
  });
  const withNavigate = validateBeatsLogic(beat([{ type: "navigate", url: "/x" }, { type: "click", selector: "#a" }]));
  check("validate_beats accepts the new navigate interaction in a beat", !withNavigate.errors.some((e) => /interactions/.test(e)));
}

console.log("\n== scenario: through the capture tools, real browser ==");
let probe = null;
try {
  probe = await launchChromium();
  await probe.close();
} catch (err) {
  skip("real scenario capture", `Chromium is not available: ${err.message}`);
  probe = null;
}

if (probe) {
  const { runCaptureScreenRecording } = require(path.join(distDir, "tools", "captureScreenRecording.js"));
  const { runCaptureScreenshot } = require(path.join(distDir, "tools", "captureScreenshot.js"));
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url.startsWith("/api/")) {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    if (req.url === "/second") {
      res.end(`<!doctype html><body style="margin:0;height:3000px"><button id="go" onclick="fetch('/api/clicked')">Go</button>
        <input id="name" oninput="fetch('/api/typed?v='+encodeURIComponent(this.value))"><div id="done" style="display:none">done</div>
        <script>setTimeout(()=>{document.getElementById('done').style.display='block'},300)</script></body>`);
    } else {
      res.end("<!doctype html><body>first page <a id='next' href='/second'>next</a></body>");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-scenario-"));
  fs.mkdirSync(path.join(root, "scenarios"));

  const yamlScenario = (name, extra = "") => `name: ${name}
url: ${base}/
steps:
  - action: navigate
    url: /second
  - action: wait
    selector: "#done"
    ms: 5000
  - action: click
    selector: "#go"
    settleMs: 300
  - action: type
    selector: "#name"
    text: Ada
  - action: scroll
    y: 600
    durationMs: 300
${extra}`;
  fs.writeFileSync(path.join(root, "scenarios", "flow.yaml"), yamlScenario("flow"));
  fs.writeFileSync(path.join(root, "scenarios", "flow.json"), JSON.stringify(parseScenario(yamlScenario("flow"))));

  try {
    const rec = await runCaptureScreenRecording({ projectRoot: root, beatId: "flow", scenarioPath: path.join("scenarios", "flow.yaml"), viewport: { width: 800, height: 600 } });
    check("capture_screen_recording runs a scenario file with no url and no interactions, and writes a video", fs.existsSync(rec.outPath) && fs.statSync(rec.outPath).size > 1000);
    check("the steps ran against the page, in order: it went to /second, then the click, then the typing", hits.indexOf("/second") !== -1 && hits.indexOf("/api/clicked") > hits.indexOf("/second") && hits.indexOf("/api/typed?v=Ada") > hits.indexOf("/api/clicked"));
    const cursor = JSON.parse(fs.readFileSync(`${rec.outPath}.cursor.json`, "utf8"));
    check("...and the cursor sidecar has the click and the typing as measured points", cursor.points.some((p) => p.type === "click" && p.selector === "#go") && cursor.points.some((p) => p.type === "fill" && p.selector === "#name"));
    const sidecar = JSON.parse(fs.readFileSync(`${rec.outPath}.capture.json`, "utf8"));
    check("the capture sidecar records the compiled interactions and the scenario's url", sidecar.url === `${base}/` && sidecar.interactions.length === 6 && sidecar.interactions[0].type === "navigate");

    hits.length = 0;
    const fromJson = await runCaptureScreenRecording({ projectRoot: root, beatId: "flowjson", scenarioPath: path.join("scenarios", "flow.json"), viewport: { width: 800, height: 600 } });
    check("the same scenario as JSON runs the same way", fs.existsSync(fromJson.outPath) && hits.includes("/api/clicked") && hits.includes("/api/typed?v=Ada"));

    hits.length = 0;
    const shot = await runCaptureScreenshot({ projectRoot: root, beatId: "flowshot", scenarioPath: path.join("scenarios", "flow.yaml"), viewport: { width: 800, height: 600 } });
    check("capture_screenshot takes a scenario file too", fs.existsSync(shot.outPath) && hits.includes("/api/clicked"));

    // The call's url wins over the scenario's.
    hits.length = 0;
    fs.writeFileSync(path.join(root, "scenarios", "nourl.yaml"), "steps:\n  - action: wait\n    ms: 50\n");
    const withUrl = await runCaptureScreenshot({ projectRoot: root, beatId: "nourl", scenarioPath: path.join("scenarios", "nourl.yaml"), url: `${base}/second`, viewport: { width: 800, height: 600 } });
    check("a scenario with no url takes the call's", fs.existsSync(withUrl.outPath) && hits.includes("/second"));

    const refuse = async (input) => {
      try {
        await runCaptureScreenRecording({ projectRoot: root, beatId: "bad", viewport: { width: 800, height: 600 }, ...input });
        return "";
      } catch (err) {
        return String(err.message);
      }
    };
    check("scenarioPath together with interactions is refused", /not both/.test(await refuse({ scenarioPath: "scenarios/flow.yaml", interactions: [] })));
    check("a scenario with no url and no url in the call is refused", /sets no url/.test(await refuse({ scenarioPath: "scenarios/nourl.yaml" })));
    check("a missing scenario file is refused with its path", /No scenario file at .*missing\.yaml/.test(await refuse({ scenarioPath: "scenarios/missing.yaml", url: base })));
    check("a scenario path that escapes the project is refused", (await refuse({ scenarioPath: "../outside.yaml", url: base })) !== "");
    fs.writeFileSync(path.join(root, "scenarios", "broken.yaml"), "steps:\n  - action: drag\n");
    check("an invalid scenario file is refused with the step named", /steps\.0\.action/.test(await refuse({ scenarioPath: "scenarios/broken.yaml", url: base })));
    check("neither url nor scenarioPath is refused", /url is required/.test(await refuse({})));

    // Without a scenario nothing changed.
    hits.length = 0;
    const plain = await runCaptureScreenshot({ projectRoot: root, beatId: "plain", url: `${base}/second`, interactions: [{ type: "click", selector: "#go" }], viewport: { width: 800, height: 600 } });
    check("a plain url and interactions call behaves as before", fs.existsSync(plain.outPath) && hits.includes("/api/clicked"));
  } finally {
    server.close();
  }
}

finish();
