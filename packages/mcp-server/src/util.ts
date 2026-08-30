import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

export function resolveProjectRoot(projectRoot?: string): string {
  return projectRoot ? path.resolve(projectRoot) : process.cwd();
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Validates a value used as a single path segment (project/video name, beat id)
 * before it's joined into any filesystem path or process argv. Rejects `..`,
 * `/`, `\`, and anything else outside a conservative safe set.
 */
export function sanitizeSegment(value: string, label: string): string {
  if (!SAFE_SEGMENT.test(value)) {
    throw new Error(
      `${label} "${value}" is not a safe path segment. Use letters, numbers, "-", or "_", starting with a letter or number.`,
    );
  }
  return value;
}

/**
 * PascalCases an id for use as a component/file name: split on any run of
 * non-alphanumeric characters, capitalize the first letter of each remaining
 * segment, join. A result starting with a digit gets an "S" prefix (invalid
 * JS identifier otherwise); an empty result (all-symbol id) falls back to "Scene".
 * scaffold_scene and stitch_composition both call this, so a beat's scene file name
 * and its import in the generated composition always agree.
 */
export function pascalCase(id: string): string {
  const parts = id.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const pascal = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  const safe = pascal.length > 0 ? pascal : "Scene";
  return /^[0-9]/.test(safe) ? `S${safe}` : safe;
}

// Blocks shell metacharacters relevant on POSIX (;&|`$<>) and on Windows cmd.exe
// specifically (%^"), which matters here because render_video spawns npx.cmd --
// Windows can only execute a .cmd/.bat file via cmd.exe, and Node's spawn() handles
// that by shelling out internally even with shell:false, so cmd.exe's own
// metacharacters are back in scope for any argument reaching that spawn call.
const DANGEROUS_CHARS = /[;&|`$<>\n\r%^"]/;

/**
 * Validates a path argument that will be handed to a spawned child process
 * (npx/ffmpeg): no shell metacharacters, and must resolve inside `root` so a
 * crafted `../../` can't point the command at an arbitrary filesystem location.
 */
export function sanitizeRelativeOutPath(root: string, relPath: string, label: string): string {
  if (DANGEROUS_CHARS.test(relPath)) {
    throw new Error(`${label} "${relPath}" contains disallowed characters.`);
  }
  const rootResolved = path.resolve(root);
  const resolved = path.resolve(rootResolved, relPath);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    throw new Error(`${label} "${relPath}" must resolve inside the project root.`);
  }
  return relPath;
}

/**
 * Copies a directory tree, skipping any `node_modules` subtree and never
 * overwriting a file that already exists at the destination -- used by
 * init_project to lay the bundled template shell into a user's project without
 * clobbering anything the dev (or a prior init_project call, for a second video
 * in the same project) has already touched.
 */
export function copyTemplateTree(src: string, dest: string): void {
  if (!fs.existsSync(src)) {
    throw new Error(
      `Template directory not found at ${src}. This package's build step (scripts/copy-template.mjs) may not have run.`,
    );
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyTemplateTree(s, d);
    } else if (!fs.existsSync(d)) {
      fs.copyFileSync(s, d);
    }
  }
}

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs a child process to completion and captures its stdout/stderr in memory.
 * Always `spawn` with an argv array (`shell: false`), never `exec`/`execSync`
 * with an interpolated shell string -- render_video and qc_extract_frames both
 * go through this. Capturing the child's output here has nothing to do with
 * *this* process's own stdout (the MCP transport); it's returned as normal
 * tool-result content by the caller.
 */
export function spawnCapture(command: string, args: string[], cwd: string): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
