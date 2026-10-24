#!/usr/bin/env node
// write-description-lesson: a lesson's description carries its practice question and the comment prompt, the
// answer goes only to ANSWER.md, and the config's disclaimers close the description, each once (#156). A project
// without those fields gets byte-for-byte the description it always got.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { require, distDir, check, finish } from "./_harness.mjs";

const { runWriteDescription } = require(path.join(distDir, "tools", "writeDescription.js"));
const { writeConfig, loadConfig, DEFAULT_CONFIG } = require(path.join(distDir, "config.js"));
const { createMcpServer } = require(path.join(distDir, "server.js"));

const BEATS = {
  fps: 30,
  beats: [
    { id: "situation", start: 0, duration: 300, vo: "Maya keeps 1000 rupees in a jar. Will it grow?" },
    { id: "idea", start: 300, duration: 300, vo: "A bank pays interest each year." },
    { id: "practice", start: 600, duration: 300, vo: "Put your answer in the comments. How much is in the jar after three years?" },
  ],
};
const QUESTION = "How much is in the jar after three years at five percent?";
const ANSWER = "1157.63 rupees";

const created = [];
function project({ mode, disclaimers, card }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-wdl-"));
  created.push(root);
  writeConfig(root, { ...(mode ? { production: { mode } } : {}), ...(disclaimers ? { disclaimers } : {}) });
  const dir = path.join(root, "src", "videos", "lesson");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "beats.json"), JSON.stringify(BEATS));
  if (card) fs.writeFileSync(path.join(dir, "concept.json"), JSON.stringify(card));
  return root;
}
const read = (root, name) => fs.readFileSync(path.join(root, "output", name), "utf8");
const occurrences = (text, needle) => text.split(needle).length - 1;

try {
  console.log("\n== a question and an answer: the question and the prompt in the description, the answer in ANSWER.md only ==");
  {
    const root = project({ mode: "supernova", card: { goal: "g", terms: [], example: "e", practiceQuestion: QUESTION, answer: ANSWER } });
    const r = runWriteDescription({ projectRoot: root, videoName: "lesson" });
    const description = read(root, "lesson-DESCRIPTION.md");
    check("the description has the question", description.includes(QUESTION));
    check("and the line \"Drop your answer in the comments.\" once, after the question", occurrences(description, "Drop your answer in the comments.") === 1 && description.indexOf(QUESTION) < description.indexOf("Drop your answer in the comments."));
    check("the answer is nowhere in the description", !description.includes(ANSWER) && !description.includes("1157"));
    check("ANSWER.md sits next to the description and holds the answer", r.answerPath === path.join(root, "output", "lesson-ANSWER.md") && read(root, "lesson-ANSWER.md").includes(ANSWER));
    check("without answerWorking the pinned comment is just the answer", read(root, "lesson-ANSWER.md") === `Answer: ${ANSWER}\n`);
    check("the result reports the question and the path", r.practiceQuestion === QUESTION);
    check("chapter timestamps are as they were", JSON.stringify(r.chapters) === JSON.stringify(["0:00 Situation", "0:10 Idea", "0:20 Practice"]) && description.includes("0:00 Situation\n0:10 Idea\n0:20 Practice"));
    check("the constructed-explanation line is still there", description.includes("This video is a constructed explanation, not footage."));
  }

  console.log("\n== answerWorking gives the pinned comment its one line of working ==");
  {
    const root = project({ mode: "supernova", card: { goal: "g", terms: [], example: "e", practiceQuestion: QUESTION, answer: ANSWER, answerWorking: "1000 x 1.05^3 = 1157.63" } });
    runWriteDescription({ projectRoot: root, videoName: "lesson" });
    const answer = read(root, "lesson-ANSWER.md");
    check("ANSWER.md is the answer and its working, two lines", answer === `Answer: ${ANSWER}\nWorking: 1000 x 1.05^3 = 1157.63\n`);
    check("the working stays out of the description too", !read(root, "lesson-DESCRIPTION.md").includes("1.05^3"));
  }

  console.log("\n== controls: a card without both fields writes no question and no ANSWER.md ==");
  for (const [label, card] of [
    ["a question and no answer", { goal: "g", terms: [], example: "e", practiceQuestion: QUESTION }],
    ["an answer and no question", { goal: "g", terms: [], example: "e", answer: ANSWER }],
    ["no concept card", undefined],
  ]) {
    const root = project({ mode: "supernova", card });
    const r = runWriteDescription({ projectRoot: root, videoName: "lesson" });
    const description = read(root, "lesson-DESCRIPTION.md");
    check(`${label}: no prompt, no ANSWER.md, no answerPath`, !description.includes("Drop your answer") && !fs.existsSync(path.join(root, "output", "lesson-ANSWER.md")) && r.answerPath === undefined);
  }
  {
    const root = project({ card: { goal: "g", terms: [], example: "e", practiceQuestion: QUESTION, answer: ANSWER } });
    const r = runWriteDescription({ projectRoot: root, videoName: "lesson" });
    check("a project that is not a lesson ignores the card", !read(root, "lesson-DESCRIPTION.md").includes("Drop your answer") && r.answerPath === undefined && !fs.existsSync(path.join(root, "output", "lesson-ANSWER.md")));
  }

  console.log("\n== disclaimers: each line exactly once, at the end ==");
  {
    const lines = ["Constructed animation, not footage.", "Not affiliated with or endorsed by any exam board."];
    const root = project({ mode: "supernova", disclaimers: [...lines, lines[0]], card: { goal: "g", terms: [], example: "e", practiceQuestion: QUESTION, answer: ANSWER } });
    const r = runWriteDescription({ projectRoot: root, videoName: "lesson" });
    const description = read(root, "lesson-DESCRIPTION.md");
    check("every line appears exactly once, even if the config repeats one", lines.every((l) => occurrences(description, l) === 1));
    check("they are the last lines, in order, after the credits", description.endsWith(`${lines.join("\n")}\n`) && description.indexOf("## Credits") < description.indexOf(lines[0]));
    check("the result lists them", JSON.stringify(r.disclaimers) === JSON.stringify(lines));
    check("the disclaimers are not in ANSWER.md", !read(root, "lesson-ANSWER.md").includes(lines[0]));
    const noCard = project({ mode: "supernova", disclaimers: lines });
    runWriteDescription({ projectRoot: noCard, videoName: "lesson" });
    check("they close a lesson that has no practice question too", read(noCard, "lesson-DESCRIPTION.md").endsWith(`${lines.join("\n")}\n`));
    const again = runWriteDescription({ projectRoot: root, videoName: "lesson" });
    check("running it again does not add them twice", occurrences(read(root, "lesson-DESCRIPTION.md"), lines[1]) === 1 && again.written === true);
    const same = project({ mode: "supernova", disclaimers: ["This video is a constructed explanation, not footage."] });
    runWriteDescription({ projectRoot: same, videoName: "lesson" });
    check("a disclaimer the description already says is not repeated", occurrences(read(same, "lesson-DESCRIPTION.md"), "This video is a constructed explanation, not footage.") === 1);
    const standard = project({ disclaimers: lines });
    runWriteDescription({ projectRoot: standard, videoName: "lesson" });
    check("control: a project that is not a lesson does not get them", !read(standard, "lesson-DESCRIPTION.md").includes(lines[0]));
  }

  console.log("\n== config: disclaimers load, merge and stay out of a config that has none ==");
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ovs-wdl-"));
    created.push(root);
    writeConfig(root, {});
    check("a config written without disclaimers has no such key, as before", !("disclaimers" in JSON.parse(fs.readFileSync(path.join(root, "openvidstudio.config.json"), "utf8"))) && loadConfig(root).disclaimers === undefined && !("disclaimers" in DEFAULT_CONFIG));
    writeConfig(root, { disclaimers: ["a", "b"] });
    writeConfig(root, { targetDurationSeconds: 30 });
    check("disclaimers are kept by a later patch that does not mention them", JSON.stringify(loadConfig(root).disclaimers) === JSON.stringify(["a", "b"]) && loadConfig(root).targetDurationSeconds === 30);
    writeConfig(root, { disclaimers: ["c"] });
    check("and replaced by one that does", JSON.stringify(loadConfig(root).disclaimers) === JSON.stringify(["c"]));
  }

  console.log("\n== regression: a project without any of the new fields gets the description it always got ==");
  {
    const LEGACY_HEAD = [
      "# lesson",
      "",
      "Maya keeps 1000 rupees in a jar. Will it grow?",
      "",
      "Length: 30s across 3 beats.",
      "",
      "## Chapters",
      "",
      "0:00 Situation",
      "0:10 Idea",
      "0:20 Practice",
      "",
      "## What this video shows",
      "",
      "- **situation** (10s): Maya keeps 1000 rupees in a jar. Will it grow?",
      "- **idea** (10s): A bank pays interest each year.",
      "- **practice** (10s): Put your answer in the comments. How much is in the jar after three years?",
      "",
    ];
    const CREDITS = [
      "## Credits",
      "",
      "- Made with openvidstudio (https://github.com/AnayDhawan/openvidstudio), an open-source video pipeline for software projects.",
      "- Narration: synthesized speech (edge-tts, voice en-US-AndrewNeural).",
      "",
    ];
    const lessonOld = [...LEGACY_HEAD, "This video is a constructed explanation, not footage.", "", ...CREDITS].join("\n");
    const lesson = project({ mode: "supernova", card: { goal: "g", terms: [], example: "e" } });
    runWriteDescription({ projectRoot: lesson, videoName: "lesson" });
    check("a lesson with no practice question and no disclaimers: byte-identical to the old output", read(lesson, "lesson-DESCRIPTION.md") === lessonOld);
    const standardOld = [...LEGACY_HEAD, ...CREDITS].join("\n");
    const standard = project({});
    const r = runWriteDescription({ projectRoot: standard, videoName: "lesson" });
    check("a standard project: byte-identical to the old output", read(standard, "lesson-DESCRIPTION.md") === standardOld);
    check("and its result has no new keys", JSON.stringify(Object.keys(r).sort()) === JSON.stringify(["chapters", "credits", "path", "sampleContentDisclosed", "written"]));
    const withQuestion = project({ mode: "supernova", card: { goal: "g", terms: [], example: "e", practiceQuestion: QUESTION, answer: ANSWER } });
    runWriteDescription({ projectRoot: withQuestion, videoName: "lesson" });
    check("control: the same comparison fails for a description that has a question", read(withQuestion, "lesson-DESCRIPTION.md") !== lessonOld);
  }

  console.log("\n== the tool description ==");
  {
    const d = createMcpServer()._registeredTools["write_description"].description;
    check("it mentions the practice question, ANSWER.md and the disclaimers", /practiceQuestion/.test(d) && /ANSWER\.md/.test(d) && /disclaimers/.test(d) && /answerPath/.test(d));
  }
} finally {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
}

finish();
