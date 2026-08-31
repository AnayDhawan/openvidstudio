/**
 * Gallery entries: one per real, rendered example video, in the same
 * mp4+poster shape personal-repos/portfolio's own DEMO_MEDIA record uses
 * (see src/lib/project-media.ts there). A small array rather than a lookup
 * record since /gallery renders every entry in order rather than looking
 * one up per project id, but the shape (mp4/poster under
 * apps/site/public/brand/, `<name>-demo.mp4` + `<name>-demo-poster.jpg`) is
 * identical.
 *
 * Task 4 ships exactly one entry, built end to end by the real
 * openvidstudio MCP pipeline (init_project -> beats.json -> validate_beats
 * -> write_beats_file -> scaffold_scene -> capture_screenshot /
 * capture_screen_recording -> stitch_composition -> render_video) against a
 * small fictional "TaskFlow" product served locally for the capture step.
 * A future task can push more entries onto this array without touching the
 * page that renders it.
 */
export type GalleryEntry = {
  id: string;
  title: string;
  caption: string;
  mp4: string;
  poster: string;
};

export const GALLERY_ENTRIES: GalleryEntry[] = [
  {
    id: 'openvidstudio-sample',
    title: 'TaskFlow (fictional demo product)',
    caption:
      "This clip was built end to end by openvidstudio's own MCP tools, not hand-edited: " +
      'init_project scaffolded the project, four beats were validated and written to ' +
      'beats.json, scaffold_scene generated each shot, the board and workflow beats were ' +
      'captured for real against a small fictional task-tracker app served locally, ' +
      'stitch_composition assembled the timeline, and render_video produced this file with ' +
      "a real Remotion render. TaskFlow itself is not a real product; it exists only to " +
      'give the pipeline something real to point a browser at.',
    mp4: '/brand/openvidstudio-sample-demo.mp4',
    poster: '/brand/openvidstudio-sample-demo-poster.jpg',
  },
];
