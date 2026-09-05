# output/

Everything `render_video`, `contact_sheet`, and `qc_extract_frames` produce lands
here: the rendered `<videoName>.mp4`, `contact-sheet.jpg`, and the `qc/<videoName>/`
frame stills used for visual QC.

This folder is gitignored (see `.gitignore` here) since renders are build output,
not source. Pick the finished video up from `output/<videoName>.mp4`, or point an
upload step at that path.
