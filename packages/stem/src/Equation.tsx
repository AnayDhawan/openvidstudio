import React, { useEffect, useMemo, useState } from "react";
import { cancelRender, continueRender, delayRender, useCurrentFrame, useVideoConfig } from "remotion";
import { E, tween } from "@openvidstudio/core";
import { VOID } from "./designSystem";
import { cachedSvg, texToSvg } from "./mathjax";
import type { Point } from "./paths";

export interface EquationProps {
  /** The equation, as TeX. */
  tex: string;
  /**
   * The equation as it is said, in plain words ("x squared plus one"). Required: a lesson's
   * narration and its equation must say the same thing, and check_script compares this string with
   * the narration of the beat. It is exposed on the element as `data-spoken`.
   */
  spoken: string;
  /** Composition frame the first term appears. Default 0. */
  at?: number;
  /** Font size in px. Default 8.5% of the shorter side of the frame. */
  size?: number;
  /** Defaults to the Void's warm white. */
  color?: string;
  /** Centre of the equation. Default: the centre of the frame. */
  center?: Point;
  /** Frames between one term appearing and the next. Default 7. */
  stagger?: number;
}

/** The frames a single term takes to arrive. */
export const EQUATION_TERM_FRAMES = 10;

interface Parsed {
  svg: SVGSVGElement;
}

/**
 * The typeset equation as a DOM element. Parsed as HTML, which accepts what the SVG serialisation of
 * MathJax's output contains; an XML parser rejects it when the TeX has a control character in it
 * (MathJax keeps the TeX in a data-latex attribute, and a plain JavaScript string "\frac" holds a form feed).
 */
function parse(markup: string): Parsed {
  const doc = new DOMParser().parseFromString(markup, "text/html");
  const svg = doc.body.querySelector("svg");
  if (!svg) throw new Error("Equation: the typeset markup has no <svg> in it.");
  return { svg: svg as unknown as SVGSVGElement };
}

/** The top-level terms of a typeset equation: the children of the root mrow, left to right. */
function termsOf(root: Element): { parent: Element; kids: Element[] } | null {
  const math = root.querySelector('g[data-mml-node="math"]');
  if (!math) return null;
  const parent = math.children.length === 1 && math.children[0].getAttribute("data-mml-node") === "mrow" ? math.children[0] : math;
  return { parent, kids: Array.from(parent.children) };
}

/**
 * An equation, typeset in sans-serif maths and revealed term by term: each top-level term fades in and
 * rises a little, one after another, as a pure function of the frame. Sized from the composition.
 */
export const Equation: React.FC<EquationProps> = ({ tex, spoken, at = 0, size, color, center, stagger = 7 }) => {
  if (typeof spoken !== "string" || spoken.trim() === "") {
    throw new Error("Equation: `spoken` is required, the equation as it is said (for example \"x squared plus one\"), so the narration and the equation can be checked against each other.");
  }
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const [markup, setMarkup] = useState<string | undefined>(() => cachedSvg(tex));
  const [handle] = useState(() => delayRender(`Equation: typesetting ${tex.slice(0, 40)}`));

  useEffect(() => {
    if (markup !== undefined) {
      continueRender(handle);
      return;
    }
    let alive = true;
    texToSvg(tex).then(
      (svg) => {
        if (!alive) return;
        setMarkup(svg);
      },
      (err) => cancelRender(err),
    );
    return () => {
      alive = false;
    };
  }, [tex, markup, handle]);

  const parsed = useMemo(() => (markup === undefined ? null : parse(markup)), [markup]);
  if (!parsed) return null;

  const px = size ?? Math.round(Math.min(width, height) * 0.085);
  const c = center ?? { x: width / 2, y: height / 2 };
  // Rebuild the equation's own structure around each term, so the term's own transform is untouched.
  const html = (() => {
    const root = parsed.svg.cloneNode(true) as SVGSVGElement;
    const terms = termsOf(root);
    // Unrecognised structure: show the equation whole rather than not at all.
    if (!terms) return root.outerHTML;
    terms.kids.forEach((kid, i) => {
      const start = at + i * stagger;
      const p = tween(frame, [start, start + EQUATION_TERM_FRAMES], [0, 1], E.cinematic);
      const wrapper = root.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "g");
      // Fill and stroke opacity, not `opacity`: group opacity makes the browser rasterise each term
      // into an offscreen layer, whose antialiasing can differ by a few levels from one visit to the
      // same frame to the next. The markup for a frame is always identical; this keeps the pixels close.
      wrapper.setAttribute("fill-opacity", p.toFixed(4));
      wrapper.setAttribute("stroke-opacity", p.toFixed(4));
      // The root group is flipped (scale(1,-1)), so a negative y is down: terms rise from 0.25em below.
      wrapper.setAttribute("transform", `translate(0,${(-(1 - p) * 250).toFixed(2)})`);
      terms.parent.replaceChild(wrapper, kid);
      wrapper.appendChild(kid);
    });
    return root.outerHTML;
  })();
  return (
    <div
      data-ovs-equation=""
      data-spoken={spoken}
      data-tex={tex}
      style={{
        position: "absolute",
        left: c.x,
        top: c.y,
        transform: "translate(-50%, -50%)",
        fontSize: px,
        color: color ?? VOID.text,
        lineHeight: 0,
        pointerEvents: "none",
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
