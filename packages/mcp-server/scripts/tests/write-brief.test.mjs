#!/usr/bin/env node
// write-brief: Part 51 (split out of the former single manual-test.mjs; see _harness.mjs)

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  require,
  __dirname,
  packageRoot,
  distDir,
  monorepoRoot,
  monorepoTemplateDir,
  check,
  skip,
  listFilesRecursive,
  setQuiet,
  finish,
} from "./_harness.mjs";

console.log("\n== Part 51: write_brief -- validation and the two-file write (C1) ==");
{
  const { validateBriefLogic, runWriteBrief } = require(path.join(distDir, "tools", "writeBrief.js"));

  const validBrief = {
    creativeLevel: "mid",
    logline: "A flashcard app that remembers what you forget.",
    audience: "Technical interview candidates short on review time.",
    feeling: "Relieved, like the hard part is already handled.",
    storyDevice: { device: "before and after", reason: "the product's whole pitch is a before/after of review time." },
    arc: {
      hook: "A candidate staring at a pile of unreviewed cards.",
      tension: "The pile keeps growing faster than they can clear it.",
      turn: "Loomcard reorders the pile by what they are about to forget.",
      proof: "A real review session, cards reordered live.",
      payoff: "The pile is gone, replaced by a clean streak counter.",
      cta: "Start a deck free.",
    },
    designSystem: {
      path: "src/videos/loomcard/design.ts",
      paletteRationale: "extract_brand found a cool blue/teal pair from the logo, kept as the two accent roles.",
      motif: "rounded-soft",
      motifRationale: "the product's own card corners are heavily rounded.",
      motionRationale: "a calm drift, nothing punchy, matches the relieved feeling.",
    },
    music: {
      bpm: 100,
      key: "A minor",
      sectionMap: [
        { label: "intro", startBar: 1, endBar: 5 },
        { label: "groove", startBar: 5, endBar: 17 },
      ],
      impactPoints: [{ name: "turn", bar: 9, note: 'beat "turn" starts at bar 9' }],
    },
    shotList: [
      { beatId: "hook", real: true, provenance: "capture_screenshot of the empty-state pile", focalPoint: "the pile count" },
      {
        beatId: "turn", real: false, provenance: "dom-demo reorder animation",
        whyConstructed: "the real reorder is instant, slowed down here for legibility", focalPoint: "the reordering motion",
      },
    ],
  };

  check("a fully-filled brief passes validation", validateBriefLogic(validBrief).valid);

  const missingLevel = { ...validBrief, creativeLevel: "extreme" };
  check(
    "an invalid creativeLevel is rejected, naming the field",
    !validateBriefLogic(missingLevel).valid && validateBriefLogic(missingLevel).errors.some((e) => e.includes("creativeLevel")),
  );

  const missingPayoff = { ...validBrief, arc: { ...validBrief.arc, payoff: "" } };
  check(
    "a blank arc.payoff is rejected, naming the exact nested field",
    !validateBriefLogic(missingPayoff).valid && validateBriefLogic(missingPayoff).errors.some((e) => e === "arc.payoff must be a non-empty string"),
  );

  const backwardsSection = {
    ...validBrief,
    music: { ...validBrief.music, sectionMap: [{ label: "intro", startBar: 10, endBar: 2 }] },
  };
  check(
    "a section with endBar before startBar is rejected",
    !validateBriefLogic(backwardsSection).valid && validateBriefLogic(backwardsSection).errors.some((e) => e.includes("endBar")),
  );

  const gapped = { ...validBrief, music: { ...validBrief.music, sectionMap: [{ label: "intro", startBar: 1, endBar: 4 }, { label: "groove", startBar: 5, endBar: 9 }] } };
  check(
    "a gap between sections is rejected here, before compose_score would reject it, naming both sections",
    !validateBriefLogic(gapped).valid && validateBriefLogic(gapped).errors.some((e) => /sectionMap\[1\]\.startBar \(5\) must equal music\.sectionMap\[0\]\.endBar \(4\)/.test(e)),
  );
  const overlapped = { ...validBrief, music: { ...validBrief.music, sectionMap: [{ label: "intro", startBar: 1, endBar: 6 }, { label: "groove", startBar: 5, endBar: 9 }] } };
  check("an overlap between sections is rejected the same way", !validateBriefLogic(overlapped).valid && validateBriefLogic(overlapped).errors.some((e) => /must equal/.test(e)));
  const emptySection = { ...validBrief, music: { ...validBrief.music, sectionMap: [{ label: "intro", startBar: 1, endBar: 1 }] } };
  check("a section of zero bars is rejected", !validateBriefLogic(emptySection).valid && validateBriefLogic(emptySection).errors.some((e) => /must be greater than startBar/.test(e)));

  const unexplainedConstructed = {
    ...validBrief,
    shotList: [{ beatId: "hook", real: false, provenance: "built from scratch", focalPoint: "x" }],
  };
  check(
    "a constructed shot with no whyConstructed is rejected",
    !validateBriefLogic(unexplainedConstructed).valid &&
      validateBriefLogic(unexplainedConstructed).errors.some((e) => e.includes("whyConstructed")),
  );

  const emDashed = { ...validBrief, feeling: "Relieved\u2014like the hard part is handled." };
  check(
    "an em dash anywhere in the brief is caught, not just in top-level fields",
    !validateBriefLogic(emDashed).valid && validateBriefLogic(emDashed).errors.some((e) => /em dash/.test(e)),
  );

  const held = { ...validBrief, shotList: validBrief.shotList.map((s, i) => (i === 0 ? { ...s, deliberateHold: true } : s)) };
  check("a shot may be marked deliberateHold: true", validateBriefLogic(held).valid === true);
  const badHold = { ...validBrief, shotList: validBrief.shotList.map((s, i) => (i === 0 ? { ...s, deliberateHold: "yes" } : s)) };
  check("deliberateHold must be a boolean", !validateBriefLogic(badHold).valid && validateBriefLogic(badHold).errors.some((e) => /deliberateHold must be a boolean/.test(e)));

  const unexplainedSample = {
    ...validBrief,
    sampleContent: [{ beatId: "hook", whatItIs: "a fictional app" }],
  };
  check(
    "a sampleContent entry missing whyConstructed is rejected",
    !validateBriefLogic(unexplainedSample).valid && validateBriefLogic(unexplainedSample).errors.some((e) => e.includes("whyConstructed")),
  );

  // The real two-file write.
  const briefRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-c1-brief-"));
  const writeResult = runWriteBrief({
    projectRoot: briefRoot,
    videoName: "loomcard",
    briefMarkdown: "Why this story device: the product's whole pitch IS a before/after.",
    briefJson: validBrief,
  });
  check("a valid brief writes both files", writeResult.written === true);
  const briefMdPath = path.join(briefRoot, "src", "videos", "loomcard", "brief.md");
  const briefJsonPath = path.join(briefRoot, "src", "videos", "loomcard", "brief.json");
  check("brief.md exists, written verbatim", fs.existsSync(briefMdPath) && fs.readFileSync(briefMdPath, "utf8").startsWith("Why this story device"));
  check("brief.json exists, parses back to the same creativeLevel", fs.existsSync(briefJsonPath) && JSON.parse(fs.readFileSync(briefJsonPath, "utf8")).creativeLevel === "mid");

  const invalidWriteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-c1-brief-invalid-"));
  const invalidWrite = runWriteBrief({
    projectRoot: invalidWriteRoot,
    videoName: "loomcard",
    briefMarkdown: "doesn't matter",
    briefJson: missingPayoff,
  });
  check("an invalid brief returns { valid: false, errors } instead of writing", invalidWrite.written !== true && Array.isArray(invalidWrite.errors));
  check(
    "...and writes neither file",
    !fs.existsSync(path.join(invalidWriteRoot, "src", "videos", "loomcard", "brief.md")) &&
      !fs.existsSync(path.join(invalidWriteRoot, "src", "videos", "loomcard", "brief.json")),
  );
}

finish();
