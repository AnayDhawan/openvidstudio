import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../config";
import { resolveProjectRoot, sanitizeSegment, sanitizeRelativeOutPath, pascalCase } from "../util";
import { runTool } from "./mcp";
import { writeFactRecord, relToProject } from "../facts";

export interface StitchCompositionInput {
  projectRoot?: string;
  videoName: string;
  /**
   * Fail instead of silently shipping a partly-silent video. A missing VO file has
   * always been survivable-by-design, but "survivable" quietly became "invisible":
   * the Audio layer is skipped with no error and the render succeeds, so the first
   * time anyone notices is on playback. Presets that declare narration mandatory
   * (2min-demo, 5min-demo) should set this.
   */
  requireNarration?: boolean;
  /**
   * Emit one composition per language, reading each language's narration from its own
   * directory. Defaults to the base language alone, which is every existing project.
   */
  languages?: string[];
  /** The language public/audio/vo/<beatId>.mp3 is in. Defaults to en. */
  baseLanguage?: string;
  /**
   * Overrides the auto-detected music bed and its mix level. `file` is a filename under
   * public/audio/ (same convention as the auto-detected pulse-bed.mp3/music-bed.mp3, not
   * an arbitrary path). `volume` defaults to 0.18 (today's under-narration level) when
   * beats.json's narration is "voice" or omitted, and 1.0 (full level, there is no VO to
   * duck under) when narration is "none".
   */
  musicBed?: { file: string; volume?: number };
}

export interface LanguageComposition {
  language: string;
  compositionId: string;
  voBeatsFound: string[];
  voBeatsMissing: string[];
}

export interface StitchCompositionResult {
  written: true;
  compositionId: string;
  demoPath: string;
  rootPath: string;
  durationInFrames: number;
  voBeatsFound: string[];
  /** Beats that will render silent. Previously knowable only by diffing two lists by hand. */
  voBeatsMissing: string[];
  musicBedFound: boolean;
  /**
   * Which bed actually got used, when one did: "music-bed.mp3" (the ambient drone) or
   * "pulse-bed.mp3" (the beat-locked rhythmic bed, see STYLE.md's "Beat-locked cuts").
   * pulse-bed.mp3 wins if a project has copied in both, since a project that went to the
   * trouble of adding the rhythmic bed almost always means to use it.
   */
  musicBedFile: string | null;
  /** The mix level actually applied to musicBedFile, honest about the default that was picked. */
  musicBedVolume: number;
  /**
   * Where the music layer came from: "explicit" (musicBed input), "preserved" (the track and
   * level the previous stitch of this video had, so a hand-picked bed survives a re-stitch),
   * "auto" (pulse-bed.mp3 / music-bed.mp3 found in public/audio), or "none".
   */
  musicBedSource: "explicit" | "preserved" | "auto" | "none";
  /**
   * Where the bed's cue grid was copied to for useMusicClock, relative to the project root, or
   * null when the bed has no <stem>.cues.json next to it (then useMusicClock reports
   * available: false and runs on a fallback grid). Run plan_music_cues to produce one.
   */
  musicCuesPath: string | null;
  /** True when src/videos/<videoName>/overrides.tsx exists and was wired into the composition. */
  overridesApplied: boolean;
  /** Plain-language notices for things that succeeded but probably are not what was wanted. */
  warnings: string[];
  /** One entry per language, including the base. */
  languages: LanguageComposition[];
}

/**
 * The registry videoName init_project seeds preflight's benchmark composition under
 * (preflight.ts) -- never a real video's name, so this entry survives every real video's
 * stitch_composition call (whose registry filter is `entries.filter(e => e.videoName !==
 * thisVideoName)`) untouched.
 */
export const PREFLIGHT_BENCHMARK_VIDEO_NAME = "__preflight__";
/** The registry entry's own composition id, what preflight's benchmark actually renders. */
export const PREFLIGHT_BENCHMARK_COMPOSITION_ID = "OvsPreflightBenchmark";

export interface RegistryEntry {
  id: string;
  videoName: string;
  componentName: string;
  importPath: string;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
}

interface BeatLike {
  id: string;
  start: number;
  duration: number;
  /**
   * C5: an explicit scene file for this beat, relative to the video directory (e.g.
   * "./scenes/Whatever.tsx"), for a hand-authored bespoke scene that doesn't live at
   * the `./scenes/<PascalId>` convention scaffold_scene writes to. The exported
   * component name is still expected to be pascalCase(id), same as the convention
   * path -- only the file location changes.
   */
  scene?: string;
}

/**
 * Registry of every video this project has stitched, one entry per stitch_composition
 * call, at src/videos/.registry.json. Root.tsx is fully regenerated from this file on
 * every call rather than round-tripped via regex/JSX parsing, which is what makes it
 * safe to never clobber a composition a prior call registered for a different video:
 * the registry (not Root.tsx itself) is the actual source of truth. Deliberately not
 * part of openvidstudio.config.json: that shape is pinned for Task 5 to depend on,
 * this is internal bookkeeping local to this one tool.
 */
export function registryPath(projectRoot: string): string {
  return path.join(projectRoot, "src", "videos", ".registry.json");
}

export function readRegistry(projectRoot: string): RegistryEntry[] {
  const p = registryPath(projectRoot);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf8")) as RegistryEntry[];
}

export function writeRegistry(projectRoot: string, entries: RegistryEntry[]): void {
  const p = registryPath(projectRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(entries, null, 2) + "\n", "utf8");
}

export function renderRootTsx(entries: RegistryEntry[], hasBrand: boolean): string {
  const imports = entries.map((e) => `import { ${e.componentName} } from "${e.importPath}";`).join("\n");
  // Brand has to evaluate before any scene module, because applyBrand mutates the
  // shared token objects rather than replacing them. Import order is evaluation order.
  const brandImport = hasBrand
    ? '// Brand first. applyBrand mutates the shared tokens, so this has to run\n' +
      '// before any scene module reads them.\nimport "./brand";\n\n'
    : "";
  const comps = entries
    .map(
      (e) =>
        `      <Composition\n        id="${e.id}"\n        component={${e.componentName}}\n` +
        `        durationInFrames={${e.durationInFrames}}\n        fps={${e.fps}}\n` +
        `        width={${e.width}}\n        height={${e.height}}\n      />`,
    )
    .join("\n");
  return `// AUTO-GENERATED by openvidstudio's stitch_composition MCP tool.
// Source of truth is src/videos/.registry.json -- hand edits to this file are lost the
// next time stitch_composition runs for ANY video in this project, not just the one you
// edited. Add a video by calling stitch_composition, not by editing this directly.

${brandImport}import React from "react";
import { Composition } from "remotion";
${imports}

export const RemotionRoot: React.FC = () => {
  return (
    <>
${comps}
    </>
  );
};
`;
}

/**
 * Import specifier for a beat's scene: its own `scene` override (extension stripped,
 * a leading "./" added if it names a bare relative path) or the `./scenes/<PascalId>`
 * convention scaffold_scene writes to. runStitchComposition validates `b.scene` stays
 * inside the video directory before this ever sees it.
 */
function sceneImportPath(b: BeatLike): string {
  if (!b.scene) return `./scenes/${pascalCase(b.id)}`;
  const normalized = b.scene.replace(/\\/g, "/").replace(/\.(tsx|ts|jsx|js)$/, "");
  return normalized.startsWith("./") || normalized.startsWith("../") ? normalized : `./${normalized}`;
}

const AUTO_MUSIC_BEDS = ["pulse-bed.mp3", "music-bed.mp3"];

/**
 * The music layer a previous stitch of this video wrote, if any. Re-stitching regenerates the
 * whole composition file, so without this a hand-picked track or level silently reverts to the
 * auto-detected bed. Matches only the exact shape renderDemoTsx emits.
 */
export function readExistingMusicLayer(
  demoPath: string,
): { file: string; volume: number; pinned: boolean } | null {
  let text: string;
  try {
    text = fs.readFileSync(demoPath, "utf8");
  } catch {
    return null;
  }
  const m = text.match(/<Audio src=\{staticFile\("audio\/([^"]+)"\)\} volume=\{([0-9.]+)\} loop \/>/);
  if (!m) return null;
  const volume = Number(m[2]);
  if (!Number.isFinite(volume)) return null;
  const file = m[1]!;
  // "pinned" = a person chose this layer, so a re-stitch must not replace it. Auto-detected
  // beds are deliberately not pinned: dropping pulse-bed.mp3 into a project that was stitched
  // with music-bed.mp3 should still upgrade it, as before.
  const marker = text.match(/ovs-music-source: (\w+)/)?.[1];
  const pinned = marker === "explicit" || marker === "preserved" || !AUTO_MUSIC_BEDS.includes(file);
  return { file, volume, pinned };
}

/**
 * The fields of public/audio/<stem>.cues.json that useMusicClock reads, or null when the bed
 * has no cues file (or it does not parse, or carries no usable bpm). The first downbeat offset
 * comes from the file's own beat list, so a found track whose first beat is not at 0:00 stays
 * aligned; compose_score's tracks start on beat 0 and get an offset of 0.
 */
function readBedCues(projectRoot: string, bedFile: string): Record<string, unknown> | null {
  const stem = bedFile.replace(/\.[^.]+$/, "");
  const cuesPath = path.join(projectRoot, "public", "audio", `${stem}.cues.json`);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(cuesPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  const bpm = raw.bpm;
  if (typeof bpm !== "number" || !(bpm > 0)) return null;
  const beats = Array.isArray(raw.beats) ? (raw.beats as unknown[]) : [];
  const first = typeof beats[0] === "number" ? (beats[0] as number) : 0;
  const out: Record<string, unknown> = { bpm, offsetSeconds: first };
  if (typeof raw.track === "string") out.track = raw.track;
  if (Array.isArray(raw.sections)) {
    out.sections = (raw.sections as Record<string, unknown>[])
      .filter((x) => typeof x.label === "string" && typeof x.startBar === "number" && typeof x.durationBars === "number")
      .map((x) => ({ label: x.label, startBar: x.startBar, durationBars: x.durationBars }));
  }
  if (Array.isArray(raw.impacts)) {
    out.impacts = (raw.impacts as Record<string, unknown>[])
      .filter((x) => typeof x.label === "string" && typeof x.atBar === "number")
      .map((x) => ({ label: x.label, atBar: x.atBar, atBeat: typeof x.atBeat === "number" ? x.atBeat : 0 }));
  }
  return out;
}

function renderDemoTsx(opts: {
  componentName: string;
  beats: BeatLike[];
  /** language -> beatId -> public-relative mp3 path. */
  voByLanguage: Record<string, Record<string, string>>;
  baseLanguage: string;
  musicBedFile: string | null;
  musicBedVolume: number;
  musicBedSource: StitchCompositionResult["musicBedSource"];
  hasMusicCues: boolean;
  hasOverrides: boolean;
}): string {
  const { componentName, beats, voByLanguage, baseLanguage, musicBedFile, musicBedVolume, musicBedSource, hasMusicCues, hasOverrides } = opts;
  const sceneImports = beats
    .map((b) => `import { ${pascalCase(b.id)} } from "${sceneImportPath(b)}";`)
    .join("\n");
  const sceneMapLines = beats.map((b) => `  ${JSON.stringify(b.id)}: ${pascalCase(b.id)},`).join("\n");

  const voBlocks = Object.entries(voByLanguage)
    .map(([lang, map]) => {
      const lines = Object.entries(map)
        .map(([id, rel]) => `    ${JSON.stringify(id)}: ${JSON.stringify(rel)},`)
        .join("\n");
      return `  ${JSON.stringify(lang)}: {\n${lines}\n  },`;
    })
    .join("\n");

  const musicBedBlock = musicBedFile
    ? `      {/* ovs-music-source: ${musicBedSource} */}
      <Sequence from={0} durationInFrames={DURATION_IN_FRAMES} layout="none">
        <Audio src={staticFile(${JSON.stringify(`audio/${musicBedFile}`)})} volume={${musicBedVolume}} loop />
      </Sequence>
`
    : "";
  // overrides.tsx is a dev-authored extension point this tool only ever references, never
  // writes: re-running stitch_composition regenerates everything above but always imports
  // the same still-there file, so a hand-added layer survives a re-stitch instead of being
  // clobbered by it.
  const overridesImport = hasOverrides ? `import Overrides from "./overrides";\n` : "";
  const overridesBlock = hasOverrides ? `      <Overrides />\n` : "";

  // One component per language, all wrapping the same inner one. The picture is identical
  // across languages, so duplicating the scene tree per language would be a second copy of
  // the thing most likely to be edited.
  const languageComponents = Object.keys(voByLanguage)
    .map((lang) =>
      lang === baseLanguage
        ? `export const ${componentName}: React.FC = () => <Narrated language=${JSON.stringify(lang)} />;`
        : `export const ${componentName}${pascalCase(lang)}: React.FC = () => <Narrated language=${JSON.stringify(lang)} />;`,
    )
    .join("\n");

  return `// AUTO-GENERATED by openvidstudio's stitch_composition MCP tool from beats.json.
// Re-run stitch_composition after editing beats.json rather than hand-editing this file;
// it will be overwritten.

import React from "react";
import { AbsoluteFill, Audio, Sequence, Series, staticFile } from "remotion";
import { MusicClockProvider } from "@openvidstudio/core";
import beats from "./beats.json";
${hasMusicCues ? `import musicCues from "./music.cues.json";
` : ""}${overridesImport}${sceneImports}

const SCENES: Record<string, React.FC> = {
${sceneMapLines}
};

// Only the narration differs per language, so there is one scene tree and one audio map
// per language over it.
const VO_FILES: Record<string, Record<string, string>> = {
${voBlocks}
};

const last = beats.beats[beats.beats.length - 1];
export const DURATION_IN_FRAMES = last.start + last.duration;

// The score's grid, handed to useMusicClock(beatId) in any scene. BEAT_STARTS turns the track's
// bars into scene-local frames.
const MUSIC_CUES = ${hasMusicCues ? "musicCues" : "null"};
const BEAT_STARTS: Record<string, number> = Object.fromEntries(beats.beats.map((b) => [b.id, b.start]));

const Narrated: React.FC<{ language: string }> = ({ language }) => {
  const vo = VO_FILES[language] ?? {};
  return (
    <AbsoluteFill>
      <MusicClockProvider cues={MUSIC_CUES} beatStarts={BEAT_STARTS}>
        <Series>
          {beats.beats.map((b) => {
            const Scene = SCENES[b.id];
            return (
              <Series.Sequence key={b.id} durationInFrames={b.duration} name={b.id}>
                <Scene />
              </Series.Sequence>
            );
          })}
        </Series>
      </MusicClockProvider>
      {beats.beats
        .filter((b) => vo[b.id])
        .map((b) => (
          <Sequence key={\`vo-\${b.id}\`} from={b.start} durationInFrames={b.duration} layout="none">
            <Audio src={staticFile(vo[b.id])} volume={0.9} />
          </Sequence>
        ))}
${musicBedBlock}${overridesBlock}    </AbsoluteFill>
  );
};

${languageComponents}
`;
}

/**
 * Reads src/videos/<videoName>/beats.json and writes the composition + updates
 * src/Root.tsx (via the registry above). VO convention: public/audio/vo/<beatId>.mp3,
 * included only if the file actually exists on disk (mirrors PepirosDemo.tsx, where
 * the cta beat has no VO entry because none was recorded). Music bed convention:
 * public/audio/music-bed.mp3, included as a full-duration looping layer only if it
 * exists.
 */
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*$/;

function sanitizeLanguage(tag: string): string {
  if (!LANGUAGE_TAG.test(tag)) {
    throw new Error(`"${tag}" is not a BCP-47 language tag, and it is used as a directory name.`);
  }
  return tag;
}

export function runStitchComposition(input: StitchCompositionInput): StitchCompositionResult {
  const result = stitchComposition(input);
  writeFactRecord(resolveProjectRoot(input.projectRoot), {
    tool: "stitch_composition",
    videoName: sanitizeSegment(input.videoName, "videoName"),
    facts: {
      compositionId: result.compositionId,
      durationInFrames: result.durationInFrames,
      voBeatsFound: result.voBeatsFound,
      voBeatsMissing: result.voBeatsMissing,
      musicBedFound: result.musicBedFound,
      musicBedFile: result.musicBedFile,
      musicBedVolume: result.musicBedVolume,
      warnings: result.warnings,
    },
  });
  return result;
}

function stitchComposition(input: StitchCompositionInput): StitchCompositionResult {
  const videoName = sanitizeSegment(input.videoName, "videoName");
  const projectRoot = resolveProjectRoot(input.projectRoot);
  const videoDir = path.join(projectRoot, "src", "videos", videoName);
  const beatsPath = path.join(videoDir, "beats.json");

  if (!fs.existsSync(beatsPath)) {
    throw new Error(`${beatsPath} does not exist. Call write_beats_file for "${videoName}" first.`);
  }
  const beatsData = JSON.parse(fs.readFileSync(beatsPath, "utf8")) as {
    fps?: number;
    beats?: BeatLike[];
    narration?: "voice" | "none";
  };
  const beats = beatsData.beats;
  if (!Array.isArray(beats) || beats.length === 0) {
    throw new Error(`${beatsPath} has no beats.`);
  }
  for (const b of beats) {
    if (b.scene) sanitizeRelativeOutPath(videoDir, b.scene, `beat "${b.id}"'s scene`);
  }

  const config = loadConfig(projectRoot);
  const fps = beatsData.fps ?? config.videoConfig.fps;
  const last = beats[beats.length - 1];
  const durationInFrames = last.start + last.duration;

  const baseLanguage = sanitizeLanguage(input.baseLanguage ?? "en");
  const languages = (input.languages?.length ? input.languages : [baseLanguage]).map(sanitizeLanguage);
  if (!languages.includes(baseLanguage)) languages.unshift(baseLanguage);

  const voByLanguage: Record<string, Record<string, string>> = {};
  const warnings: string[] = [];
  const languageReports: LanguageComposition[] = [];

  const componentName = `${pascalCase(videoName)}Demo`;

  for (const language of languages) {
    const isBase = language === baseLanguage;
    // The base language keeps the original flat path, so nothing that already has
    // narration has to move.
    const publicRel = isBase ? "audio/vo" : `audio/vo/${language}`;
    const map: Record<string, string> = {};
    for (const b of beats) {
      if (fs.existsSync(path.join(projectRoot, "public", ...publicRel.split("/"), `${b.id}.mp3`))) {
        map[b.id] = `${publicRel}/${b.id}.mp3`;
      }
    }
    voByLanguage[language] = map;

    const missing = beats.map((b) => b.id).filter((id) => !(id in map));
    // A video declared narration: "none" is silent on purpose. Warning that every beat has no voice
    // contradicts the mode the beats file itself declares, and buries a real warning under eight
    // that are not. requireNarration still means what it says, so it is not skipped.
    const silentOnPurpose = beatsData.narration === "none" && input.requireNarration !== true;
    if (missing.length > 0 && !silentOnPurpose) {
      const detail =
        `${missing.length} of ${beats.length} beats have no ${language} narration file and will render ` +
        `silent: ${missing.join(", ")}. Expected at public/${publicRel}/<beatId>.mp3. ` +
        `Run generate_narration, or accept the silence deliberately.`;
      // Per language, deliberately: a video that is fully narrated in English and half
      // narrated in Hindi is a failure of the Hindi cut, and saying so once for the whole
      // stitch would hide which cut is broken.
      if (input.requireNarration === true) {
        throw new Error(`Narration is required for this composition but ${detail}`);
      }
      warnings.push(detail);
    }

    languageReports.push({
      language,
      compositionId: isBase ? componentName : `${componentName}${pascalCase(language)}`,
      voBeatsFound: Object.keys(map),
      voBeatsMissing: missing,
    });
  }

  const voMap = voByLanguage[baseLanguage];
  const voBeatsMissing = languageReports.find((r) => r.language === baseLanguage)!.voBeatsMissing;

  const demoPath = path.join(videoDir, `${componentName}.tsx`);
  const existingLayer = readExistingMusicLayer(demoPath);
  const existingLayerUsable =
    existingLayer !== null &&
    existingLayer.pinned &&
    fs.existsSync(path.join(projectRoot, "public", "audio", existingLayer.file));
  if (existingLayer?.pinned && !existingLayerUsable && !input.musicBed?.file) {
    warnings.push(
      `The previous stitch used public/audio/${existingLayer.file} as the music bed, but that file is gone. ` +
        `Falling back to auto-detection. Restore the file or pass musicBed to pick one explicitly.`,
    );
  }

  let musicBedFile: string | null;
  let musicBedSource: StitchCompositionResult["musicBedSource"];
  if (input.musicBed?.file) {
    const exists = fs.existsSync(path.join(projectRoot, "public", "audio", input.musicBed.file));
    if (!exists) {
      throw new Error(`musicBed.file "${input.musicBed.file}" does not exist at public/audio/${input.musicBed.file}`);
    }
    musicBedFile = input.musicBed.file;
    musicBedSource = "explicit";
  } else if (existingLayer && existingLayerUsable) {
    // A re-stitch must not undo a hand-picked track. Auto-detection only decides the first time.
    musicBedFile = existingLayer.file;
    musicBedSource = "preserved";
  } else {
    const pulseBedPresent = fs.existsSync(path.join(projectRoot, "public", "audio", "pulse-bed.mp3"));
    const musicBedPresent = fs.existsSync(path.join(projectRoot, "public", "audio", "music-bed.mp3"));
    musicBedFile = pulseBedPresent ? "pulse-bed.mp3" : musicBedPresent ? "music-bed.mp3" : null;
    musicBedSource = musicBedFile ? "auto" : "none";
  }
  const musicBedFound = musicBedFile !== null;
  // No VO to duck under when narration is "none", so the bed defaults to full level instead
  // of the 0.18 tuned for sitting quietly beneath narration. A preserved layer keeps the level
  // it had, since that may have been tuned by hand.
  const narrationMode = beatsData.narration === "none" ? "none" : "voice";
  const musicBedVolume =
    input.musicBed?.volume ??
    (musicBedSource === "preserved" && existingLayer ? existingLayer.volume : narrationMode === "none" ? 1.0 : 0.18);
  const hasOverrides = fs.existsSync(path.join(videoDir, "overrides.tsx"));

  // The bed's cue grid, copied next to the composition because a scene bundle can import JSON
  // from src/ but not from public/. Trimmed to what useMusicClock reads.
  const musicCuesAbs = path.join(videoDir, "music.cues.json");
  const musicCues = musicBedFile ? readBedCues(projectRoot, musicBedFile) : null;
  if (musicCues) {
    fs.writeFileSync(musicCuesAbs, JSON.stringify(musicCues, null, 2) + "\n", "utf8");
  } else if (fs.existsSync(musicCuesAbs)) {
    fs.rmSync(musicCuesAbs);
  }

  const demoTsx = renderDemoTsx({
    componentName,
    beats,
    voByLanguage,
    baseLanguage,
    musicBedFile,
    musicBedVolume,
    musicBedSource,
    hasMusicCues: musicCues !== null,
    hasOverrides,
  });
  fs.writeFileSync(demoPath, demoTsx, "utf8");

  const entries = readRegistry(projectRoot).filter((e) => e.videoName !== videoName);
  for (const report of languageReports) {
    entries.push({
      id: report.compositionId,
      videoName,
      componentName: report.compositionId,
      importPath: `./videos/${videoName}/${componentName}`,
      durationInFrames,
      fps,
      width: config.videoConfig.width,
      height: config.videoConfig.height,
    });
  }
  writeRegistry(projectRoot, entries);

  const rootPath = path.join(projectRoot, "src", "Root.tsx");
  fs.writeFileSync(
    rootPath,
    renderRootTsx(entries, fs.existsSync(path.join(projectRoot, "src", "brand.ts"))),
    "utf8",
  );

  return {
    written: true,
    compositionId: componentName,
    demoPath,
    rootPath,
    durationInFrames,
    voBeatsFound: Object.keys(voMap),
    voBeatsMissing,
    musicBedFound,
    musicBedFile,
    musicBedVolume,
    musicBedSource,
    musicCuesPath: musicCues ? relToProject(projectRoot, musicCuesAbs) : null,
    overridesApplied: hasOverrides,
    warnings,
    languages: languageReports,
  };
}

export function registerStitchComposition(server: McpServer): void {
  server.registerTool(
    "stitch_composition",
    {
      title: "Stitch a video's beats into a composition",
      description:
        "Reads src/videos/<videoName>/beats.json and writes src/videos/<videoName>/<PascalName>Demo.tsx: a " +
        "SCENES map from beat id to its scaffold_scene component (imported from ./scenes/<BeatId>, the same " +
        "PascalCase convention scaffold_scene uses -- beats without a scaffolded scene file will fail to " +
        "type-check, scaffold every beat first), a <Series> of <Series.Sequence> per beat, a VO Audio layer " +
        "per beat only where public/audio/vo/<beatId>.mp3 actually exists on disk, and a looping " +
        "full-duration music bed layer if public/audio/pulse-bed.mp3 or public/audio/music-bed.mp3 exists " +
        "(pulse-bed wins if both are present). pulse-bed.mp3 is the beat-locked rhythmic bed from the " +
        "built-in pack, generated at a known 112bpm with an exact cue grid in public/sfx/pulse-bed.cues.json " +
        "(or plan_music_cues for any other track), so scene cuts can land on a beat instead of an arbitrary " +
        "second. music-bed.mp3 is the older ambient drone with no pulse to cut against. Also (re)registers the " +
        "composition in src/Root.tsx (via an internal src/videos/.registry.json this tool owns), without " +
        "clobbering compositions a prior stitch_composition call registered for a different video in the " +
        "same project. Pass languages to emit one composition per language: the picture is shared and only the "
        + "narration layer differs, so the generated file carries one scene tree and one audio map per "
        + "language, reading public/audio/vo/<lang>/<beatId>.mp3 for every language but the base, which "
        + "keeps the original flat path. requireNarration is then enforced per language, because a video "
        + "fully narrated in English and half narrated in Hindi is a failure of the Hindi cut and saying so "
        + "once for the whole stitch would hide which cut is broken. Pass musicBed to override the "
        + "auto-detected bed file and its mix level: file is a filename under public/audio/ (same convention "
        + "as the auto-detected pulse-bed.mp3/music-bed.mp3), volume defaults to 0.18 when beats.json's "
        + "narration is \"voice\" or omitted (today's under-narration tuning) and 1.0 when narration is "
        + "\"none\" (there is no VO to duck under). When musicBed is omitted and a previous stitch of this "
        + "video already wrote a music layer whose file still exists, that track and level are preserved "
        + "(musicBedSource: \"preserved\") instead of reverting to auto-detection. If src/videos/<videoName>/overrides.tsx exists, it is "
        + "imported and rendered as an extra layer inside the composition on every stitch, a dev-authored "
        + "extension point this tool only ever references and never writes, so it survives a re-stitch "
        + "instead of being clobbered by one.",
      inputSchema: {
        projectRoot: z.string().optional(),
        videoName: z.string().min(1),
        requireNarration: z.boolean().optional(),
        languages: z.array(z.string()).optional(),
        baseLanguage: z.string().optional(),
        musicBed: z.object({ file: z.string().min(1), volume: z.number().min(0).optional() }).optional(),
      },
    },
    async (input) => runTool("stitch_composition", () => runStitchComposition(input)),
  );
}
