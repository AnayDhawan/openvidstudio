import type { Page } from "playwright";

/**
 * Page-side helpers for splitting a capture into layers: a background with chosen elements
 * gone, and one transparent image per element.
 *
 * Elements are isolated with `visibility`, never `display`, so nothing moves: every other box
 * keeps its layout, and each element stays exactly where it was in the full screenshot. CSS
 * visibility lets a child re-show itself inside a hidden parent, which is what makes "hide
 * everything except this subtree" work without touching the subtree's own look. The shots
 * themselves are ordinary full-viewport screenshots cropped afterwards, not Playwright's
 * element-scoped ones, which CAPTURE.md explains re-measure and auto-scroll at shot time.
 */

/** One element a layer selector matched, in viewport CSS pixels, with the id used to find it again. */
export interface LayerElement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const LAYER_ATTR = "data-ovs-layer";
const HIDE_ATTR = "data-ovs-hide";
const SHOW_ATTR = "data-ovs-show";
const ISOLATE_ATTR = "data-ovs-isolate";
const STYLE_ID = "__ovs-layers-style";

/**
 * Tags every element a selector matches with a stable id and measures it. `group` keeps ids from
 * different selectors apart. Throws a clear error naming the selector when it is not valid CSS;
 * an empty result is the caller's to report, since only it knows what the layer was for.
 */
export async function tagLayerElements(page: Page, selector: string, group: number): Promise<LayerElement[]> {
  try {
    return await page.evaluate(
      ({ selector: sel, group: g, attr }) => {
        const found = Array.from(document.querySelectorAll(sel));
        return found.map((el, i) => {
          const id = `${g}-${i}`;
          el.setAttribute(attr, id);
          const r = el.getBoundingClientRect();
          return { id, x: r.x, y: r.y, width: r.width, height: r.height };
        });
      },
      { selector, group, attr: LAYER_ATTR },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`layers: selector "${selector}" could not be queried (${message.split("\n")[0]})`);
  }
}

/**
 * Freezes every CSS and Web Animations animation where it stands, so the background, the layers
 * and the full screenshot are all the same instant of a page that never stops moving.
 */
export async function pauseAnimations(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      try {
        animation.pause();
      } catch {
        // An animation that cannot be paused is left running; the shots then differ in its region only.
      }
    }
  });
}

async function installStyle(page: Page): Promise<void> {
  await page.evaluate(
    ({ id, hide, show, isolate }) => {
      if (document.getElementById(id)) return;
      const style = document.createElement("style");
      style.id = id;
      // transition: none is what makes the toggles instant. A page with `transition: all` would
      // otherwise keep a hidden element visible for the length of its transition, and the shot
      // taken a frame later would still contain it.
      style.textContent =
        `html[${isolate}] *, html[${isolate}] *::before, html[${isolate}] *::after { transition: none !important; }` +
        `[${hide}] { visibility: hidden !important; }` +
        `[${show}] { visibility: visible !important; }` +
        `html[${isolate}="clear"], html[${isolate}="clear"] body { background: transparent !important; background-image: none !important; }`;
      document.head.appendChild(style);
    },
    { id: STYLE_ID, hide: HIDE_ATTR, show: SHOW_ATTR, isolate: ISOLATE_ATTR },
  );
}

async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/**
 * Leaves only one tagged element (and its subtree) visible, on a transparent page, ready for a
 * screenshot with omitBackground. Everything else keeps its box, so the element does not move.
 */
export async function showOnlyLayer(page: Page, id: string): Promise<void> {
  await installStyle(page);
  await page.evaluate(
    ({ id: target, layerAttr, hide, show, isolate }) => {
      const active = document.querySelector(`[${layerAttr}="${target}"]`);
      if (!active) throw new Error(`layers: tagged element ${target} is gone from the page`);
      for (const el of Array.from(document.querySelectorAll("*"))) {
        if (el === active || active.contains(el)) continue;
        el.setAttribute(hide, "");
      }
      active.setAttribute(show, "");
      document.documentElement.setAttribute(isolate, "clear");
    },
    { id, layerAttr: LAYER_ATTR, hide: HIDE_ATTR, show: SHOW_ATTR, isolate: ISOLATE_ATTR },
  );
  await settleFrames(page);
}

/** Hides every tagged element, leaving the page as it is otherwise: the background layer. */
export async function hideAllLayers(page: Page): Promise<void> {
  await installStyle(page);
  await page.evaluate(
    ({ layerAttr, hide, isolate }) => {
      document.documentElement.setAttribute(isolate, "keep");
      for (const el of Array.from(document.querySelectorAll(`[${layerAttr}]`))) el.setAttribute(hide, "");
    },
    { layerAttr: LAYER_ATTR, hide: HIDE_ATTR, isolate: ISOLATE_ATTR },
  );
  await settleFrames(page);
}

/**
 * Undoes showOnlyLayer and hideAllLayers, so the page is as it was between shots. Transitions
 * stay off (the isolate attribute is kept, with the page background back), because turning
 * them on in the same step as un-hiding would start a fade-in on every element just restored.
 */
export async function restoreLayers(page: Page): Promise<void> {
  await page.evaluate(
    ({ hide, show, isolate }) => {
      for (const el of Array.from(document.querySelectorAll(`[${hide}], [${show}]`))) {
        el.removeAttribute(hide);
        el.removeAttribute(show);
      }
      document.documentElement.setAttribute(isolate, "keep");
    },
    { hide: HIDE_ATTR, show: SHOW_ATTR, isolate: ISOLATE_ATTR },
  );
  await settleFrames(page);
}
