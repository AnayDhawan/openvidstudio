#!/usr/bin/env node
// unknown-inputs: a tool call with a key the tool does not take is rejected by name, not silently
// stripped (#119). The motivating case: render_video called with quality: "draft" (the option is
// draft: true) ran a full-quality render of about 15 minutes.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { require, packageRoot, distDir, check, finish } from "./_harness.mjs";

const sdk = path.join(packageRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm");
const { Client } = await import(pathToFileURL(path.join(sdk, "client", "index.js")).href);
const { InMemoryTransport } = await import(pathToFileURL(path.join(sdk, "inMemory.js")).href);
const { createMcpServer } = require(path.join(distDir, "server.js"));

async function connect() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  await server.connect(serverSide);
  const client = new Client({ name: "ovs-unknown-inputs-test", version: "1.0.0" });
  await client.connect(clientSide);
  return { client, server };
}

async function call(client, name, args) {
  try {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
    return { isError: !!r.isError, text };
  } catch (err) {
    // The SDK reports a failed schema validation as a protocol error; some versions throw it.
    return { isError: true, text: String(err && err.message ? err.message : err) };
  }
}

const { client, server } = await connect();
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-unknown-"));

console.log("\n== render_video: an unknown key is rejected before any render starts ==");
{
  const r = await call(client, "render_video", { projectRoot: root, videoName: "demo", quality: "draft" });
  check("quality: \"draft\" is an error, not a render", r.isError === true);
  check("...which names the unknown key", /\bquality\b/.test(r.text));
  check("...and lists the valid ones, draft included", /\bdraft\b/.test(r.text) && /\bvideoName\b/.test(r.text));
  check("...and no render output or job was started", !fs.existsSync(path.join(root, "out")) && !fs.existsSync(path.join(root, ".openvidstudio")));
  const control = await call(client, "render_video", { projectRoot: root, videoName: "demo", draft: true });
  check("control: the same call with draft: true gets past input validation (it fails later, on the missing project)", !/unrecognized|unknown input/i.test(control.text));
}

console.log("\n== near-miss keys get a suggestion ==");
{
  const r = await call(client, "write_beats_file", { projectRot: root, videoName: "x", beatsJson: {} });
  check("projectRot is rejected", r.isError === true && /projectRot\b/.test(r.text));
  check("...with a did-you-mean for projectRoot", /did you mean[^.]*projectRoot/i.test(r.text));
  const far = await call(client, "write_beats_file", { videoName: "x", beatsJson: {}, zzzzzzzz: 1 });
  check("a key that resembles nothing gets no suggestion", far.isError === true && !/did you mean/i.test(far.text));
}

console.log("\n== valid calls are unchanged ==");
{
  const beats = {
    fps: 30,
    title: "T",
    narration: "none",
    beats: [{ id: "a", start: 0, duration: 90, visual: { captureMethod: "dom-demo" } }],
  };
  const v = await call(client, "validate_beats", { beatsJson: beats });
  check("validate_beats with a valid call returns its normal result", v.isError === false && JSON.parse(v.text).valid === true);
  const w = await call(client, "write_beats_file", { projectRoot: root, videoName: "ok", beatsJson: beats });
  check("write_beats_file with a valid call writes", w.isError === false && JSON.parse(w.text).written === true);
  const noArgs = await call(client, "preflight", {});
  check("a tool called with its optional inputs omitted is unaffected", !/unrecognized|unknown input/i.test(noArgs.text));
}

console.log("\n== every registered tool with an input schema is strict ==");
{
  const tools = Object.entries(server._registeredTools);
  const loose = tools.filter(([, t]) => t.inputSchema && t.inputSchema._zod?.def?.catchall === undefined);
  check(`all ${tools.length} tools reject unknown keys (none left in strip mode)`, loose.length === 0);
}

await client.close();
finish();
