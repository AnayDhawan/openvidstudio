import type { Metadata } from 'next';
import { Reveal } from '@/components/Reveal';

export const metadata: Metadata = {
  title: 'MCP - openvidstudio',
  description:
    'What MCP is, the exact install and config steps for the openvidstudio server, and how the Higgsfield tier is gated.',
};

const mcpConfigSnippet = `{
  "mcpServers": {
    "openvidstudio": {
      "command": "npx",
      "args": ["-y", "@openvidstudio/mcp-server"]
    }
  }
}`;

const projectConfigSnippet = `{
  "hasHiggsfield": false,
  "targetDurationSeconds": 60,
  "videoConfig": {
    "fps": 30,
    "width": 1920,
    "height": 1080
  }
}`;

const toolNames = [
  'init_project',
  'validate_beats',
  'write_beats_file',
  'scaffold_scene',
  'stitch_composition',
  'render_video',
  'qc_extract_frames',
  'capture_screenshot',
  'capture_screen_recording',
];

export default function McpPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <Reveal className="max-w-2xl">
        <img src="/brand/icon-mcp.png" alt="" aria-hidden="true" className="size-11" />
        <p className="mt-5 font-mono text-xs tracking-wide text-muted-foreground">MCP</p>
        <h1 className="mt-3 text-balance font-heading text-3xl font-semibold sm:text-4xl">
          One protocol, no separate app to open.
        </h1>
      </Reveal>

      <Reveal delayMs={60} className="mt-8">
        <p className="text-pretty leading-relaxed text-muted-foreground">
          MCP (Model Context Protocol) is a standard way for an AI coding agent to call tools
          a separate local process exposes, the same shape as a function call, over stdio
          instead of an HTTP API. Your agent (Claude Code, Cursor, or anything else that
          speaks MCP) starts the process, reads the list of tools it offers, and calls them
          with structured arguments when a task needs one. openvidstudio ships as one such
          process: a small server with nine tools (ten if Higgsfield is on) that scaffold a
          project, validate and write beats.json, capture real screenshots and recordings,
          scaffold scenes, stitch the composition, render, and extract QC frames. There is no
          openvidstudio app to open separately; your agent is the interface.
        </p>
      </Reveal>

      <Reveal delayMs={100} className="mt-12">
        <h2 className="font-heading text-lg font-semibold">Prerequisites</h2>
        <ul className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground">
          <li>Node.js, to run the server via npx (no separate install step).</li>
          <li>An MCP-capable coding agent: Claude Code, Cursor, or any client that reads a standard mcpServers config block.</li>
          <li>Playwright's browser binaries, for the capture tools (the server depends on the playwright package; its own postinstall handles the browser download).</li>
        </ul>
      </Reveal>

      <Reveal delayMs={140} className="mt-12">
        <h2 className="font-heading text-lg font-semibold">1. Add the server to your agent</h2>
        <p className="mt-3 max-w-2xl text-pretty text-sm text-muted-foreground">
          Drop this into your MCP client's config (Claude Code's <code className="rounded border border-border bg-card px-1 py-0.5 font-mono text-xs">.mcp.json</code>,
          or the equivalent block in whichever client you use). The client reads
          <code className="mx-1 rounded border border-border bg-card px-1 py-0.5 font-mono text-xs">mcpServers</code>
          at startup, launches <code className="rounded border border-border bg-card px-1 py-0.5 font-mono text-xs">command</code> with
          <code className="mx-1 rounded border border-border bg-card px-1 py-0.5 font-mono text-xs">args</code>, and talks to it over stdio from then on.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl border border-border bg-card p-4 font-mono text-xs leading-relaxed text-foreground/90">
          <code>{mcpConfigSnippet}</code>
        </pre>
        <p className="mt-3 text-pretty text-xs text-muted-foreground">
          <code className="rounded border border-border bg-card px-1 py-0.5">npx -y @openvidstudio/mcp-server</code> resolves the
          package's one binary (<code className="rounded border border-border bg-card px-1 py-0.5">openvidstudio-mcp</code>) and
          runs it; nothing to install globally first.
        </p>
      </Reveal>

      <Reveal delayMs={180} className="mt-12">
        <h2 className="font-heading text-lg font-semibold">2. Point it at a project</h2>
        <p className="mt-3 max-w-2xl text-pretty text-sm text-muted-foreground">
          Ask your agent to run <code className="rounded border border-border bg-card px-1 py-0.5 font-mono text-xs">init_project</code>.
          It scaffolds <code className="rounded border border-border bg-card px-1 py-0.5 font-mono text-xs">src/videos/&lt;name&gt;/</code> in
          your repo, copies the pipeline docs into <code className="rounded border border-border bg-card px-1 py-0.5 font-mono text-xs">docs/</code>,
          and writes <code className="rounded border border-border bg-card px-1 py-0.5 font-mono text-xs">openvidstudio.config.json</code> at
          your project root:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl border border-border bg-card p-4 font-mono text-xs leading-relaxed text-foreground/90">
          <code>{projectConfigSnippet}</code>
        </pre>
      </Reveal>

      <Reveal delayMs={220} className="mt-12">
        <h2 className="font-heading text-lg font-semibold">The hasHiggsfield gate</h2>
        <p className="mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
          <code className="rounded border border-border bg-card px-1 py-0.5 font-mono text-xs">import_higgsfield_clip</code>, the tool
          that ingests an AI-generated b-roll clip into this pipeline's asset convention, is
          only registered when <code className="rounded border border-border bg-card px-1 py-0.5 font-mono text-xs">hasHiggsfield</code> is
          <code className="mx-1 rounded border border-border bg-card px-1 py-0.5 font-mono text-xs">true</code> in your project's config,
          read once at server startup. Set it to <code className="rounded border border-border bg-card px-1 py-0.5 font-mono text-xs">false</code> (the
          default) and the tool simply doesn't appear in your agent's tool list: not
          present-but-erroring, absent. openvidstudio never holds a Higgsfield API key and
          never talks to Higgsfield itself; using this tier at all means you already have a
          Higgsfield subscription and its own MCP connector enabled in the same agent
          session, and your agent generates the clip over that connection directly. This
          server's tool only takes the finished result and lands it at the right path.
        </p>
      </Reveal>

      <Reveal delayMs={260} className="mt-12">
        <h2 className="font-heading text-lg font-semibold">Every tool this server exposes</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {toolNames.map((tool) => (
            <code
              key={tool}
              className="rounded-full border border-border bg-card px-2.5 py-1 font-mono text-xs text-foreground/90"
            >
              {tool}
            </code>
          ))}
          <code className="rounded-full border border-dashed border-accent/40 bg-transparent px-2.5 py-1 font-mono text-xs text-accent">
            import_higgsfield_clip (gated)
          </code>
        </div>
        <p className="mt-4 max-w-2xl text-pretty text-sm text-muted-foreground">
          See{' '}
          <a href="/how-it-works" className="text-primary underline underline-offset-4">
            how it works
          </a>{' '}
          for what each one does, in the order your agent actually calls them.
        </p>
      </Reveal>
    </div>
  );
}
