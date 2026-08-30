# HIGGSFIELD.md: the AI b-roll tier

This is the protocol for the one gap real capture can't fill: an
atmosphere/b-roll shot with no real product UI in it at all (a desk/hands
shot, an establishing texture, an abstract visual metaphor). Everything else
in this pipeline stays real by provenance, per `STYLE.md`; this tier exists
for the beats where "real" was never an option in the first place.

## Prerequisite

Using this tier at all requires two things the calling dev, not
openvidstudio, provides:

1. **A Higgsfield subscription.**
2. **The Higgsfield MCP connector enabled in the dev's AI coding agent
   session** (Claude Code, Cursor, or whatever else the dev is running
   openvidstudio's own MCP tools alongside).

openvidstudio never holds a Higgsfield API key, never authenticates to
Higgsfield, and never bills anyone for a generation. There is no clean way
for one local MCP server to reach into a different, already-authorized MCP
connection that only the calling agent's own client session holds: MCP's
protocol gives a server exactly three ways to ask its client for help
(sampling, for an LLM completion; elicitation, for a form/URL prompt to the
user; and a roots list), and none of them is "call this other tool on this
other server for me." So the design here isn't a workaround, it's the only
architecture the protocol actually supports: the calling agent uses its own
Higgsfield connection directly, and openvidstudio only receives what that
connection already produced.

## Config gate

`import_higgsfield_clip` (the one tool this tier adds) only appears in this
server's tool list when a project's `openvidstudio.config.json` has
`"hasHiggsfield": true`. If that field is `false`, or missing entirely
(the default for any project that hasn't set it), the tool is not
registered at all, not present-but-erroring: it simply won't show up in the
calling agent's tool list for that project.

`init_project` is what sets this field, from the dev's own answer to
`PLANNING.md`'s intake question 4 ("Higgsfield access: yes or no"). A
project that answered "no" (or never ran that question) genuinely does not
have this tool available, and any beat that would have needed it either
gets dropped or reworked as a `dom-demo`, per `PLANNING.md`'s decision tree.

## Scope: b-roll and atmosphere only, never product UI or on-screen text

This is `STYLE.md`'s provenance rule, restated as the operational
consequence for anyone writing a Higgsfield prompt: an AI-generated clip
must never carry on-screen product text or real UI. Real product surfaces
are ground truth by provenance (DOM-rendered, screenshotted, or
screen-recorded, all captured per `CAPTURE.md`); an AI-generated clip is not
ground truth of anything, and mixing the two undermines the entire premise
of this pipeline, that everything on screen came from the real product.

Be honest about what enforces this: nothing here does, at the code level.
Neither the calling agent's own Higgsfield generation call nor
`import_higgsfield_clip`'s ingest step inspects the resulting video's
content. This is a convention enforced by doc guidance and by whoever
reviews the video before it ships, not a filter that can catch a
prompt-writer who ignores it. A "Higgsfield-text soft-guard linter" (an
automated check that flags a generated clip likely to contain readable text
or UI-like chrome) is a plausible future nice-to-have, but it is explicitly
out of this tool's v1 scope and does not exist yet.

## Prompt-writing guidance

Write a Higgsfield prompt around the shot's actual visual purpose in the
scene, the same way you'd brief a stock-footage search, not around "the
product." A prompt like:

> a hand typing on a mechanical keyboard, warm desk lighting, shallow depth
> of field

describes the atmosphere the beat needs and gives the model nothing to
hallucinate a screen or interface out of. A prompt like "show the product"
or "someone using the app" invites the model to render its own guess at UI,
text, or branding, which is exactly what this tier must never produce.
Before writing the prompt, know which specific beat the clip is standing in
for and what mood or texture it needs to carry; write to that, not to the
feature the beat happens to sit next to.

## What `import_higgsfield_clip` actually does

`import_higgsfield_clip` is deliberately not a wrapper with opinions about
video generation. It does not call Higgsfield's `generate_video` or
`jobs_wait` tools itself, and it does not talk to Higgsfield at all. The
calling agent does that part, over its own already-authorized Higgsfield
MCP connection, exactly the way it would for any other Higgsfield request in
the same session. Once that generation finishes, the agent has a result:
either a downloadable URL or a local file path. `import_higgsfield_clip`'s
entire job is taking that result and landing it at this project's asset
convention.

Input:

```
{
  projectRoot?: string,       // defaults to the calling agent's cwd
  beatId: string,
  source: { type: "url"; url: string } | { type: "path"; path: string },
  outPath?: string,           // override; default is public/video/<beatId>.mp4
}
```

Behavior: fetches the URL or reads the local file, then writes those bytes
to `public/video/<beatId>.mp4` under `projectRoot`, the exact same
convention `capture_screen_recording` and `scaffold_scene`'s
`higgsfield-clip` kind already use. That convention match is load-bearing:
a `higgsfield-clip` scene's `<OffthreadVideo src=...>` expects the asset at
that path regardless of which tool produced it, so a `higgsfield-clip`
scene is structurally identical to a `real-recording` scene once the asset
exists.

Returns `{ outPath, beatId }` on success. On failure (a bad or unreachable
URL, a missing local file, a failed download), it returns a structured
error the same way every other tool in this package does; it never throws
uncaught.
