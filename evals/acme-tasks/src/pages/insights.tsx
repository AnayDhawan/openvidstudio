import React from "react";
import { Shell } from "../components/Shell";

const WEEKS = [14, 18, 16, 23, 21, 27, 31, 29, 36, 41];

export default function Insights({ path }: { path: string }) {
  const max = Math.max(...WEEKS);
  return (
    <Shell path={path} title="Insights">
      <section className="insights" data-testid="insights">
        <div className="stat"><div className="k">Tasks shipped this week</div><div className="v">41</div><div className="d">+14% vs last week</div></div>
        <div className="stat"><div className="k">Median cycle time</div><div className="v">2.4d</div><div className="d">0.6d faster</div></div>
        <div className="stat"><div className="k">On-time rate</div><div className="v">93%</div><div className="d">+5 pts</div></div>
        <div className="stat streak"><div className="k">Shipping streak</div><div className="v">12 wks</div><div className="d">Best yet</div></div>
        <div className="chart">
          <h3>Tasks shipped per week</h3>
          <svg viewBox="0 0 1000 260" width="100%" height="260">
            {WEEKS.map((w, i) => {
              const h = (w / max) * 210;
              return (
                <g key={i}>
                  <rect x={30 + i * 97} y={230 - h} width={62} height={h} rx={10} fill={i === WEEKS.length - 1 ? "#0f766e" : "#cfe7e2"} />
                  <text x={61 + i * 97} y={252} textAnchor="middle" fontSize="13" fill="#a8a29e" fontFamily="Inter">W{i + 1}</text>
                </g>
              );
            })}
          </svg>
        </div>
      </section>
    </Shell>
  );
}
