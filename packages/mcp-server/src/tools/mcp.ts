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
