// The maths renderer: MathJax 4 with its sans Fira font, SVG output. Chosen over KaTeX because it is
// real sans-serif maths (math italics, Greek, `sin` and `cos` all in the one family) where KaTeX's
// `\mathsf` leaves upright variables and a serif theta. See SUPERNOVA.md for the comparison.
//
// It runs from the project's own public/mathjax/ (copied there by init_project), so a render needs
// no network, and with the SVG output and no font cache each equation is self-contained paths, so
// there is no font file to wait for and the same TeX always gives the same markup.

import { staticFile } from "remotion";

interface MathJaxApi {
  tex2svgPromise: (tex: string, options?: { display?: boolean }) => Promise<{ querySelector: (s: string) => { outerHTML: string } | null }>;
  startup: { promise: Promise<unknown> };
}

let loading: Promise<MathJaxApi> | null = null;

/** Loads MathJax once per document. Resolves when it is ready to typeset. */
export function loadMathJax(): Promise<MathJaxApi> {
  if (loading) return loading;
  loading = new Promise<MathJaxApi>((resolve, reject) => {
    const base = staticFile("mathjax");
    const w = window as unknown as { MathJax?: unknown };
    w.MathJax = {
      loader: { paths: { "mathjax-fira": `${base}/fira` }, load: ["[mathjax-fira]/svg"] },
      tex: { inlineMath: [] },
      svg: { fontCache: "none" },
      output: { font: "mathjax-fira" },
      // This is a render, not a web page: no context menu, no speech or braille, no assistive MathML.
      // The menu's own settings are what switch the speech worker on, so they are turned off too;
      // otherwise MathJax fetches sre/speech-worker.js and about 800KB of rule files and waits for them.
      options: {
        enableMenu: false,
        enableEnrichment: false,
        enableSpeech: false,
        enableBraille: false,
        a11y: { speech: false, braille: false },
        menuOptions: { settings: { speech: false, braille: false, collapsible: false, assistiveMml: false, enrich: false } },
      },
      startup: {
        typeset: false,
        ready() {
          const mj = (window as unknown as { MathJax: MathJaxApi & { startup: { defaultReady: () => void } } }).MathJax;
          mj.startup.defaultReady();
          mj.startup.promise.then(() => resolve(mj), reject);
        },
      },
    };
    const script = document.createElement("script");
    script.src = `${base}/tex-svg-nofont.js`;
    script.async = true;
    script.onerror = () => reject(new Error(`@openvidstudio/stem: could not load MathJax from ${script.src}. Is public/mathjax/ in the project? init_project with mode "supernova" puts it there.`));
    document.head.appendChild(script);
  });
  return loading;
}

const cache = new Map<string, string>();

/** The SVG markup for `tex`, typeset in the sans Fira maths font. Cached, so each equation is typeset once. */
export async function texToSvg(tex: string, display = true): Promise<string> {
  const key = `${display ? "d" : "i"}:${tex}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const mj = await loadMathJax();
  const container = await mj.tex2svgPromise(tex, { display });
  const svg = container.querySelector("svg");
  if (!svg) throw new Error(`@openvidstudio/stem: MathJax produced no SVG for ${JSON.stringify(tex)}.`);
  if (svg.outerHTML.includes('data-mml-node="merror"')) {
    throw new Error(`@openvidstudio/stem: MathJax could not parse the TeX ${JSON.stringify(tex)}.`);
  }
  cache.set(key, svg.outerHTML);
  return svg.outerHTML;
}

/** The synchronous cache read: the markup if `tex` was already typeset in this document. */
export function cachedSvg(tex: string, display = true): string | undefined {
  return cache.get(`${display ? "d" : "i"}:${tex}`);
}
