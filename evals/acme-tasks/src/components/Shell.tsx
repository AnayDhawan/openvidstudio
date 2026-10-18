import React from "react";

const NAV = [
  { href: "/", label: "Board" },
  { href: "/insights", label: "Insights" },
];

export const Shell: React.FC<{ path: string; title: string; actions?: React.ReactNode; children: React.ReactNode }> = ({ path, title, actions, children }) => (
  <div className="app">
    <aside className="side">
      <div className="brand"><img src="/acme-mark.svg" alt="" />Acme Tasks</div>
      {NAV.map((n) => (
        <a key={n.href} href={n.href} className={"nav" + (path === n.href ? " active" : "")} data-testid={"nav-" + n.label.toLowerCase()}>
          <span className="dot" />{n.label}
        </a>
      ))}
      <div className="section">Projects</div>
      <div className="proj"><span className="sw" style={{ background: "#e8590c" }} />Launch week</div>
      <div className="proj"><span className="sw" style={{ background: "#0f766e" }} />Mobile beta</div>
      <div className="proj"><span className="sw" style={{ background: "#7c3aed" }} />Docs refresh</div>
    </aside>
    <main className="main">
      <header className="top">
        <h1>{title}</h1>
        <span className="sprint">Launch week</span>
        <div className="grow" />
        <div className="search">Search tasks</div>
        <div className="avatars">
          <span className="av" style={{ background: "#e8590c" }}>MR</span>
          <span className="av" style={{ background: "#0f766e" }}>JK</span>
          <span className="av" style={{ background: "#7c3aed" }}>AP</span>
        </div>
        {actions}
      </header>
      {children}
    </main>
  </div>
);
