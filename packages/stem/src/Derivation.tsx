import React, { useEffect, useMemo, useState } from "react";
import { cancelRender, continueRender, delayRender, useCurrentFrame, useVideoConfig } from "remotion";
import { E, tween, useNarrationWords } from "@openvidstudio/core";
import { SUBJECT_ACCENT, VOID, bodyStack, type Subject } from "./designSystem";
import { EQUATION_TERM_FRAMES, parse, termsOf } from "./Equation";
import { cachedSvg, texToSvg } from "./mathjax";
import type { Point } from "./paths";

export interface DerivationStep {
  /** The line, as TeX. */
  tex: string;
  /**
   * The line as it is said, in plain words. Required, exactly as on `Equation`: it must appear in the beat's
   * narration, in the order the steps are given, and `check_script` checks that.
   */
  spoken: string;
  /** A short reason in plain words, shown with the step ("no horizontal force"). */
  because?: string;
}

export interface DerivationProps {
  steps: DerivationStep[];
  /** The beat these steps are narrated in. Each step is revealed at the word its `spoken` starts at (`useNarrationWords`). */
  beatId?: string;
  /** Explicit frames each step is revealed at, which win over the narration. A step with no entry falls back to `from` and `stagger`. */
  at?: number[];
  /** Frame the first step is revealed when there is neither narration nor `at`. Default 0. */
  from?: number;
  /** Frames between steps when there is neither narration nor `at`. Default 60. */
  stagger?: number;
  /** Font size in px. Default 7% of the shorter side, made smaller if the widest line would not fit. */
  size?: number;
  /** Defaults to the Void's warm white. */
  color?: string;
  /** Where the baseline of the current (newest) line sits, and the middle of the block. Default: the horizontal centre, 60% down a tall frame and 64% down a wide one. */
  center?: Point;
  /** Picks the colour a new term arrives in. Default "math". */
  subject?: Subject;
}

/** Frames the previous line takes to move up and dim, and the carried terms to settle into their new places. */
export const DERIVATION_MOVE_FRAMES = 14;
/** Frames between one new term and the next. */
export const DERIVATION_TERM_STAGGER = 4;
/** The most lines on screen at once: the current one and the two before it. */
export const DERIVATION_STACK = 3;

/** Brightness of a line `slot` places above the current one (0 is the current line). Zero from the third slot up, so three show. */
export function slotOpacity(slot: number): number {
  const knots: [number, number][] = [[0, 1], [1, 0.5], [2, 0.26], [3, 0]];
  if (slot <= 0) return 1;
  for (let i = 1; i < knots.length; i++) {
    if (slot <= knots[i][0]) {
      const [s0, a0] = knots[i - 1];
      const [s1, a1] = knots[i];
      return a0 + (a1 - a0) * ((slot - s0) / (s1 - s0));
    }
  }
  return 0;
}

const spokenTokens = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);

/**
 * Pure: the frame each step is revealed at. A step's `spoken` is looked for in the narration's words, in order,
 * after the previous step's; the first word it starts at is its frame. Where it is not found (or there are no
 * timings) the step takes an explicit `at[i]`, else `from + i * stagger`. Each step is at least one frame after the one before.
 */
export function revealFrames(
  steps: { spoken: string }[],
  opts: { at?: number[]; from?: number; stagger?: number; words?: { word: string }[]; frameOfWord?: (index: number) => number | null },
): number[] {
  const from = opts.from ?? 0;
  const stagger = opts.stagger ?? 60;
  const heard = (opts.words ?? []).map((w) => spokenTokens(w.word).join(" "));
  let cursor = 0;
  const out: number[] = [];
  steps.forEach((step, i) => {
    let frame: number | null = null;
    const explicit = opts.at?.[i];
    if (explicit === undefined && opts.frameOfWord && heard.length > 0) {
      const tokens = spokenTokens(step.spoken);
      for (let p = cursor; tokens.length > 0 && p + tokens.length <= heard.length; p++) {
        if (tokens.every((t, k) => heard[p + k] === t)) {
          frame = opts.frameOfWord(p);
          cursor = p + tokens.length;
          break;
        }
      }
    }
    let r = explicit ?? frame ?? from + i * stagger;
    if (i > 0) r = Math.max(r, out[i - 1] + 1);
    out.push(r);
  });
  return out;
}

interface TermInfo {
  el: Element;
  latex: string;
  x: number;
  y: number;
}

interface LineModel {
  /** The viewBox, in MathJax's units (1000 to the em): its left and top, its width and height. */
  minX: number;
  minY: number;
  width: number;
  height: number;
  terms: TermInfo[];
  structured: boolean;
}

function termInfo(el: Element): TermInfo {
  const m = /translate\(\s*(-?[\d.eE+-]+)[\s,]+(-?[\d.eE+-]+)\s*\)/.exec(el.getAttribute("transform") ?? "");
  return { el, latex: el.getAttribute("data-latex") ?? el.innerHTML, x: m ? Number(m[1]) : 0, y: m ? Number(m[2]) : 0 };
}

function modelOf(markup: string): LineModel {
  const { svg } = parse(markup);
  const [minX, minY, width, height] = (svg.getAttribute("viewBox") ?? "0 0 1000 1000").split(/[\s,]+/).map(Number);
  const found = termsOf(svg);
  return { minX, minY, width, height, terms: found ? found.kids.map(termInfo) : [], structured: found !== null };
}

/** Pure: which term of the new line is the same term as one of the old line, by longest common subsequence of their TeX. */
export function matchTerms(before: string[], after: string[]): Map<number, number> {
  const n = before.length;
  const m = after.length;
  const len: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) len[i][j] = before[i] === after[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
  const pairs = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      pairs.set(j, i);
      i++;
      j++;
    } else if (len[i + 1][j] >= len[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const mixHex = (a: string, b: string, k: number): string => {
  const x = hex(a);
  const y = hex(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(",")})`;
};

/**
 * A formula built line by line, each line spoken. The newest line sits at the bottom; the one before it moves up
 * and dims, up to a stack of three, so the viewer reads the algebra top to bottom. The lines share a left edge, as
 * algebra on paper does, and sit on a baseline, so between two lines the terms they share stay where they are (or
 * slide to their new place if the terms before them changed width), the terms that are new fade in in the accent and
 * settle to white, and the terms that are gone fade out. Term level, not per glyph.
 * `because` puts a plain-words reason under a step. A pure function of the frame, sized from the composition.
 */
export const Derivation: React.FC<DerivationProps> = ({ steps, beatId, at, from, stagger, size, color, center, subject = "math" }) => {
  steps.forEach((s, i) => {
    if (typeof s.spoken !== "string" || s.spoken.trim() === "") {
      throw new Error(`Derivation: step ${i + 1} has no \`spoken\`. Every step needs the line as it is said ("y equals u sine theta t"), so the narration and the formula can be checked against each other.`);
    }
  });
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const narration = useNarrationWords(beatId ?? "");
  const [markups, setMarkups] = useState<(string | undefined)[]>(() => steps.map((s) => cachedSvg(s.tex)));
  const [handle] = useState(() => delayRender("Derivation: typesetting the steps"));
  const key = steps.map((s) => s.tex).join("\n");

  useEffect(() => {
    if (markups.length === steps.length && markups.every((m) => m !== undefined)) {
      continueRender(handle);
      return;
    }
    let alive = true;
    Promise.all(steps.map((s) => texToSvg(s.tex))).then(
      (all) => {
        if (alive) setMarkups(all);
      },
      (err) => cancelRender(err),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, markups, handle]);

  const models = useMemo(() => (markups.length === steps.length && markups.every((m) => m !== undefined) ? markups.map((m) => modelOf(m as string)) : null), [markups, steps.length]);
  const matches = useMemo(() => (models ? models.map((model, i) => (i === 0 ? new Map<number, number>() : matchTerms(models[i - 1].terms.map((t) => t.latex), model.terms.map((t) => t.latex)))) : []), [models]);
  if (!models) return null;

  const reveals = revealFrames(steps, { at, from, stagger, words: narration.available ? narration.words : undefined, frameOfWord: narration.frameOfWord });
  const widest = Math.max(...models.map((m) => m.width)) / 1000;
  const tallest = Math.max(...models.map((m) => m.height)) / 1000;
  const px = size ?? Math.min(Math.round(Math.min(width, height) * 0.07), Math.floor((width * 0.84) / widest));
  const c = center ?? { x: width / 2, y: Math.round(height * (height > width ? 0.6 : 0.64)) };
  const slotH = Math.round(px * (tallest + 0.9));
  const accent = SUBJECT_ACCENT[subject].accent;
  const ink = color ?? VOID.text;
  const inkHex = /^#[0-9a-f]{6}$/i.test(ink) ? ink : VOID.text;
  const becauseGap = px * 0.1;
  const blockLeft = c.x - (widest * px) / 2;

  // How far each line has moved up: the sum of the moves of every later line that has arrived.
  const moved = (i: number) => steps.reduce((sum, _, j) => (j > i ? sum + tween(frame, [reveals[j], reveals[j] + DERIVATION_MOVE_FRAMES], [0, 1], E.cinematic) : sum), 0);

  return (
    <div data-ovs-derivation="" data-steps={steps.length} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {steps.map((step, i) => {
        if (frame < reveals[i]) return null;
        const slot = moved(i);
        const lineAlpha = slotOpacity(slot);
        if (lineAlpha <= 0.002) return null;
        const model = models[i];
        const svgMarkup = markups[i] as string;
        const y = c.y - slot * slotH;
        const morph = i === 0 ? 1 : tween(frame, [reveals[i], reveals[i] + DERIVATION_MOVE_FRAMES], [0, 1], E.cinematic);

        const root = parse(svgMarkup).svg;
        // 1000 units to the em exactly, so the line's size does not depend on the font's x-height, and no
        // baseline shift: the line is placed by its baseline below.
        root.setAttribute("width", `${model.width / 1000}em`);
        root.setAttribute("height", `${model.height / 1000}em`);
        root.setAttribute("style", "display:block");
        const found = termsOf(root);
        let html = root.outerHTML;
        if (found && model.structured) {
          const doc = root.ownerDocument;
          const wrap = (term: Element, state: string, latex: string, alpha: number, fill: string | null, rise: number) => {
            const g = doc.createElementNS("http://www.w3.org/2000/svg", "g");
            g.setAttribute("data-ovs-term", state);
            g.setAttribute("data-ovs-latex", latex);
            // Fill and stroke opacity, not `opacity`, as Equation does: the markup for a frame is always identical.
            g.setAttribute("fill-opacity", (alpha * lineAlpha).toFixed(4));
            g.setAttribute("stroke-opacity", (alpha * lineAlpha).toFixed(4));
            if (fill) g.setAttribute("fill", fill);
            if (rise !== 0) g.setAttribute("transform", `translate(0,${rise.toFixed(2)})`);
            found.parent.replaceChild(g, term);
            g.appendChild(term);
            return g;
          };
          let arrivals = 0;
          const previous = i > 0 ? models[i - 1] : null;
          model.terms.forEach((info, k) => {
            const term = found.kids[k];
            const oldIndex = matches[i].get(k);
            if (previous && oldIndex !== undefined) {
              // Carried: it is the same term as in the line before, so it stays where it was, sliding only if the terms before it changed width.
              const from0 = previous.terms[oldIndex].x - previous.minX;
              const to = info.x - model.minX;
              const x = from0 + (to - from0) * morph + model.minX;
              term.setAttribute("transform", `translate(${x.toFixed(2)},${info.y})`);
              wrap(term, "carried", info.latex, 1, null, 0);
              return;
            }
            const start = previous ? reveals[i] + 4 + arrivals++ * DERIVATION_TERM_STAGGER : reveals[i] + k * 7;
            const p = tween(frame, [start, start + EQUATION_TERM_FRAMES], [0, 1], E.cinematic);
            // The root group is flipped, so a negative y is down: a term rises from a quarter em below.
            const settle = previous ? tween(frame, [start + EQUATION_TERM_FRAMES, start + EQUATION_TERM_FRAMES + 26], [0, 1], E.cinematic) : 1;
            wrap(term, "new", info.latex, p, previous ? mixHex(accent, inkHex, settle) : null, -(1 - p) * 250);
          });
          if (previous && morph < 1) {
            // Gone: the terms of the line before that this one does not have, fading out where they were.
            const kept = new Set(matches[i].values());
            previous.terms.forEach((old, k) => {
              if (kept.has(k)) return;
              const ghost = doc.importNode(old.el, true) as Element;
              const x = old.x - previous.minX + model.minX;
              ghost.setAttribute("transform", `translate(${x.toFixed(2)},${old.y})`);
              const g = doc.createElementNS("http://www.w3.org/2000/svg", "g");
              g.setAttribute("data-ovs-term", "removed");
              g.setAttribute("data-ovs-latex", old.latex);
              g.setAttribute("fill-opacity", ((1 - morph) * lineAlpha).toFixed(4));
              g.setAttribute("stroke-opacity", ((1 - morph) * lineAlpha).toFixed(4));
              g.appendChild(ghost);
              found.parent.appendChild(g);
            });
          }
          html = root.outerHTML;
        } else {
          // An unrecognised structure: show the line whole rather than not at all.
          root.setAttribute("fill-opacity", lineAlpha.toFixed(4));
          html = root.outerHTML;
        }

        const descentEm = (model.minY + model.height) / 1000;
        return (
          <React.Fragment key={i}>
            <div
              data-ovs-step={i}
              data-ovs-slot={slot.toFixed(3)}
              data-ovs-line-opacity={lineAlpha.toFixed(3)}
              data-spoken={step.spoken}
              data-tex={step.tex}
              style={{
                position: "absolute",
                left: blockLeft,
                top: y + (model.minY / 1000) * px,
                fontSize: px,
                color: ink,
                lineHeight: 0,
              }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
            {step.because && (
              <div
                data-ovs-because={i}
                style={{
                  position: "absolute",
                  left: 0,
                  width,
                  top: y + descentEm * px + becauseGap,
                  textAlign: "center",
                  fontFamily: bodyStack(),
                  fontSize: Math.round(px * 0.34),
                  lineHeight: 1.2,
                  color: VOID.textDim,
                  opacity: lineAlpha * tween(frame, [reveals[i] + 6, reveals[i] + 6 + DERIVATION_MOVE_FRAMES], [0, 1], E.cinematic),
                }}
              >
                {step.because}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
