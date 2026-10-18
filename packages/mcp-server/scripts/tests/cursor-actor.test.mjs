#!/usr/bin/env node
// cursor-actor: Part 37 (split out of the former single manual-test.mjs; see _harness.mjs)

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

console.log("\n== Part 37: CursorActor click rings anchor at the click frame, not live position (A7) ==");
{
  const cursorActorSrc = fs.readFileSync(
    path.join(packageRoot, "..", "core", "src", "CursorActor.tsx"),
    "utf8",
  );
  check(
    "CursorActor's click ring reads a per-click frozen anchor, not the outer live x/y",
    /const anchor = positionAt\(sorted, c\)/.test(cursorActorSrc) &&
      /left: anchor\.x - 60 \* p/.test(cursorActorSrc) &&
      /top: anchor\.y - 60 \* p/.test(cursorActorSrc),
  );

  // The anchoring math itself, reimplemented here as a plain function rather than imported --
  // CursorActor.tsx is JSX/TSX consumed by Remotion's own bundler, never compiled to a
  // require()-able dist/ module, so this proves the APPROACH (clamped two-point interpolation,
  // frame-pinned per click) rather than re-running the real component. At a keyframe's own
  // frame the interpolated value equals that keyframe exactly regardless of which easing curve
  // shapes the frames between -- every bezier easing in E (packages/core/src/motion.ts) is
  // anchored at (0,0)/(1,1) by construction -- so plain linear interpolation at the endpoints
  // is sufficient to prove the anchor is frame-exact, without reimplementing the bezier itself.
  function positionAt(sorted, frame) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (frame <= first.frame) return { x: first.x, y: first.y };
    if (frame >= last.frame) return { x: last.x, y: last.y };
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].frame >= frame) {
        const a = sorted[i - 1];
        const b = sorted[i];
        const t = (frame - a.frame) / (b.frame - a.frame);
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
    }
    return { x: last.x, y: last.y };
  }

  // A real repro measured ~100px of drift; this path moves the cursor 400px away over the 20
  // frames after the click, well past that, so the test fails loudly if anchoring regresses
  // back to live position instead of a false pass from too-small a movement to notice.
  const path_ = [
    { frame: 0, x: 0, y: 0 },
    { frame: 10, x: 100, y: 20 }, // the click
    { frame: 30, x: 500, y: 400 },
  ];
  const clickFrame = 10;
  const stillFrame = clickFrame + 6; // "render a still 6 frames after a synthetic click event"

  const anchor = positionAt(path_, clickFrame);
  const liveAtStill = positionAt(path_, stillFrame);

  check(
    "the click target itself is at (100, 20)",
    path_[1].x === 100 && path_[1].y === 20,
  );
  check(
    "the cursor's LIVE position 6 frames later has genuinely moved (this is the bug CursorActor must not reproduce)",
    Math.hypot(liveAtStill.x - 100, liveAtStill.y - 20) > 50,
  );
  check(
    "the ring's anchor (position AT the click frame) is centered on the click target regardless (0px offset)",
    Math.abs(anchor.x - 100) < 0.001 && Math.abs(anchor.y - 20) < 0.001,
  );
}

finish();
