# PRIMITIVES.md: adding a primitive

There are two kinds of primitive, and they live in different places. Pick the one that matches what you are building.

| | Core primitive | Catalog primitive |
|---|---|---|
| What it is | A component or helper exported from `@openvidstudio/core` | A small self-contained `.tsx` file an agent can drop into one video |
| Lives in | `packages/core/src/` | `packages/mcp-server/src/primitives/registry.ts` |
| Used by | Every scene, imported from the package root | One project, copied in by `add_motion_primitive` and edited freely |
| Documented in | [API.md](API.md), with a rendered still | Found with `catalog_motion_primitives` |
| Use it when | Several scenes will want it and it should look the same everywhere | It solves one motion problem (a count-up, a card stack) and a copy the agent can adapt is fine |

If you are unsure, start with a catalog primitive. Promoting one to core later is easy; the other direction breaks videos that import it.

## Rules for both

- **Drive everything from the frame.** Remotion renders each frame on its own, so an animation has to be a function of `useCurrentFrame()`. No CSS transitions or keyframe animations, no hover states, nothing that depends on time passing in the browser.
- **Easing comes from `E`.** `packages/core/src/motion.ts` is the list. Linear easing is banned ([STYLE.md](STYLE.md)). Use `tween` (which requires a named easing and clamps the ends), `pop` and `SPRING` rather than hand-rolling interpolation.
- **Colours and fonts come from the tokens.** Use `color`, `glow` and the font stacks from `packages/core/src/tokens.ts`. Read them inside the component. `extract_brand` overwrites those objects after startup, so a value copied at module scope keeps the default and the video will not pick up the brand.
- **Timing comes in as props.** Take an `at` (start frame) and a `durationInFrames` instead of hard-coding them, so a scene can place the primitive on a beat.
- **Respect the style rules.** Read [STYLE.md](STYLE.md) before the first line. It is binding on every primitive.

## Adding a core primitive

1. Create `packages/core/src/MyPrimitive.tsx`. Export the props interface and the component.
2. Export both from `packages/core/src/index.ts`, next to the group they belong to (camera, motion helpers, scene components and so on), with the type exports on their own `export type` line like the existing ones.
3. Add a section to [API.md](API.md) with a props table (name, type, default, notes) in the same shape as the existing ones, and say when an agent should reach for it.
4. Add a render for it to `scripts/build-api-gallery.mjs`, then build and run it to produce the still:

   ```bash
   pnpm --filter @openvidstudio/mcp-server build
   node scripts/build-api-gallery.mjs
   ```

   The stills are written to `packages/docs/img/api/`. They are real renders, so re-run the script whenever the look changes.
5. Run `pnpm typecheck` and `pnpm test`.

## Adding a catalog primitive

1. In `packages/mcp-server/src/primitives/registry.ts`, add an object of type `MotionPrimitive`:
   - `name`: kebab-case and stable, because `add_motion_primitive` looks it up by this
   - `title` and `description`: what a person would search for
   - `keywords`: extra search terms the title and description do not already contain
   - `componentName`: the name the component is exported under inside `source`
   - `source`: the whole `.tsx` file as a string, starting with the shared `HEADER`
2. The source may import only `react`, `remotion` and `@openvidstudio/core`. That is what lets it drop into any project unmodified.
3. Add the object to the `MOTION_PRIMITIVES` array near the bottom of the file. Search and lookup read that array, so an entry that is not in it does not exist.
4. Add a check to the tests (see below) that the source is non-empty, that `componentName` appears in it, and that `findMotionPrimitive` returns it.

## Tests

The tests are per-tool files in `packages/mcp-server/scripts/tests/*.test.mjs`, each a separate process that builds its own fixtures.

```bash
pnpm build
pnpm test                                              # every file
node packages/mcp-server/scripts/manual-test.mjs core-primitives   # one file
```

`core-primitives.test.mjs` is the one to extend for a core primitive. Tests that need a browser, Python or ffmpeg and cannot run on your machine report that and skip.

## Before you open the PR

- It type-checks (`pnpm typecheck`) and the tests pass.
- Anything with a visual result has a still attached to the PR.
- A core primitive has its [API.md](API.md) section and gallery still; a catalog primitive is in `MOTION_PRIMITIVES`.
- No hard-coded colours, no linear easing, no animation that is not frame-driven.
