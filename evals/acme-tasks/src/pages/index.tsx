import React, { useState } from "react";
import { Shell } from "../components/Shell";

type Task = { id: number; title: string; tag: "design" | "eng" | "launch" | "docs"; who: string; color: string; due: string; progress?: number; done?: boolean; fresh?: boolean };

const INITIAL: Record<string, Task[]> = {
  Backlog: [
    { id: 1, title: "Write the v1.0 announcement post", tag: "launch", who: "MR", color: "#e8590c", due: "Fri" },
    { id: 2, title: "Empty state illustrations", tag: "design", who: "AP", color: "#7c3aed", due: "Mon" },
    { id: 3, title: "Keyboard shortcuts cheat sheet", tag: "docs", who: "JK", color: "#0f766e", due: "Tue" },
  ],
  "In progress": [
    { id: 4, title: "Recurring tasks", tag: "eng", who: "JK", color: "#0f766e", due: "Today", progress: 72 },
    { id: 5, title: "Onboarding checklist", tag: "design", who: "AP", color: "#7c3aed", due: "Thu", progress: 40 },
  ],
  Done: [
    { id: 6, title: "Drag cards between columns", tag: "eng", who: "MR", color: "#e8590c", due: "Done", done: true },
    { id: 7, title: "Team invites", tag: "eng", who: "JK", color: "#0f766e", due: "Done", done: true },
    { id: 8, title: "Pricing page copy", tag: "launch", who: "MR", color: "#e8590c", due: "Done", done: true },
  ],
};

const Card: React.FC<{ t: Task }> = ({ t }) => (
  <div className={"card" + (t.fresh ? " new" : "")} data-testid={"task-" + t.id}>
    <div className="t">{t.title}</div>
    {t.progress !== undefined ? <div className="progress"><i style={{ width: t.progress + "%" }} /></div> : null}
    <div className="meta">
      <span className={"tag " + t.tag}>{t.tag === "eng" ? "Engineering" : t.tag[0].toUpperCase() + t.tag.slice(1)}</span>
      <span className="grow" />
      {t.done ? <span className="check on" /> : <span>{t.due}</span>}
      <span className="av" style={{ background: t.color, width: 24, height: 24, fontSize: 10, marginLeft: 0, border: 0 }}>{t.who}</span>
    </div>
  </div>
);

export default function Board({ path }: { path: string }) {
  const [cols, setCols] = useState(INITIAL);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const save = () => {
    const t: Task = { id: 9, title: title || "Untitled task", tag: "launch", who: "MR", color: "#e8590c", due: "Today", fresh: true };
    setCols({ ...cols, Backlog: [t, ...cols.Backlog] });
    setOpen(false);
    setTitle("");
  };
  return (
    <Shell path={path} title="Board" actions={<button id="new-task" className="btn" onClick={() => setOpen(true)}>+ New task</button>}>
      <section className="board">
        {Object.entries(cols).map(([name, tasks]) => (
          <div className="col" key={name} data-testid={"col-" + name}>
            <h2>{name} <span className="count">{tasks.length}</span></h2>
            {tasks.map((t) => <Card key={t.id} t={t} />)}
          </div>
        ))}
      </section>
      {open ? (
        <div className="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="modal" id="task-modal">
            <h3>New task</h3>
            <label className="field">Title<input id="task-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" /></label>
            <label className="field">Project<select defaultValue="launch"><option value="launch">Launch week</option></select></label>
            <div className="row"><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button><button id="save" className="btn" onClick={save}>Create task</button></div>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}
