import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * MCP content + error-wrapping helpers, matching pepiros/mcp/tools/index.ts's pattern:
 * MCP wants `{ content: [...] }`, JSON text content keeps it parseable on the model's side.
 */

export function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function errorText(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/**
 * Every tool handler routes through this: run the pure logic function, wrap a
 * successful result as MCP JSON content, and turn any thrown error into MCP
 * error content instead of letting it escape uncaught. A "no, this is invalid"
 * result (validate_beats' `{ valid: false, errors }`, scaffold_scene refusing an
 * existing file) is handled by the logic function returning/throwing normally --
 * this wrapper is what guarantees neither path ever reaches the transport as an
 * unhandled rejection. The diagnostic also goes to stderr: this process's own
 * stdout carries nothing but MCP protocol frames.
 */
export async function runTool<T>(toolName: string, fn: () => T | Promise<T>) {
  try {
    const result = await fn();
    return json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`openvidstudio-mcp: ${toolName} failed: ${message}\n`);
    return errorText(message);
  }
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

function closestKey(unknown: string, valid: string[]): string | undefined {
  const squash = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = squash(unknown);
  let best: { key: string; distance: number } | undefined;
  for (const key of valid) {
    const distance = editDistance(target, squash(key));
    if (distance <= 2 && (best === undefined || distance < best.distance)) best = { key, distance };
  }
  return best?.key;
}

function isRawShape(value: unknown): value is Record<string, z.ZodType> {
  return (
    typeof value === "object" &&
    value !== null &&
    !("_zod" in value) &&
    Object.values(value).every((v) => typeof v === "object" && v !== null && "_zod" in v)
  );
}

/**
 * The MCP SDK builds a zod object from a tool's input shape, and zod strips keys it does not know,
 * so a call like render_video { quality: "draft" } (the option is `draft`) silently ran a full
 * render. This makes every tool registered on `server` strict instead: an unknown key is an input
 * error that names it, lists the valid keys, and suggests the closest one. Call it before the
 * tools are registered.
 */
export function rejectUnknownInputs(server: McpServer): void {
  const register = server.registerTool.bind(server) as (name: string, config: Record<string, unknown>, cb: unknown) => unknown;
  (server as unknown as { registerTool: typeof register }).registerTool = (name, config, cb) => {
    const shape = config.inputSchema;
    if (!isRawShape(shape)) return register(name, config, cb);
    const valid = Object.keys(shape);
    const strict = z.strictObject(shape, {
      error: (issue) => {
        if (issue.code !== "unrecognized_keys") return undefined;
        const unknown = issue.keys as string[];
        const hints = unknown.map((key) => {
          const near = closestKey(key, valid);
          return near ? ` (did you mean \`${near}\`?)` : "";
        });
        return (
          `Unknown input ${unknown.map((k, i) => `\`${k}\`${hints[i]}`).join(", ")} for ${name}, ` +
          `nothing was run. Valid inputs: ${valid.length > 0 ? valid.join(", ") : "(none)"}.`
        );
      },
    });
    return register(name, { ...config, inputSchema: strict }, cb);
  };
}
