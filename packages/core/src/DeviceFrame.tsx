// Browser window frame (macOS chrome + URL pill) hosting arbitrary DOM content.

import React from "react";
import { color, panelShadow, radius } from "./tokens";

// System-safe fallback, avoids @remotion/google-fonts' network fetch (hangs render offline).
const uiFamily = "Inter, -apple-system, Segoe UI, Roboto, sans-serif";

export const BrowserFrame: React.FC<{
  url: string;
  width?: number;
  height?: number;
  dark?: boolean;
  children: React.ReactNode;
}> = ({ url, width = 1360, height = 850, dark = true, children }) => {
  const chrome = dark ? "#151A24" : "#EDF0F4";
  const body = dark ? "#0E1219" : "#FFFFFF";
  const border = dark ? color.panelBorder : "#D8DEE7";
  const text = dark ? color.textSecondary : "#5B6572";
  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius.window,
        background: body,
        border: `1px solid ${border}`,
        boxShadow: panelShadow(dark),
        overflow: "hidden",
        fontFamily: uiFamily,
      }}
    >
      <div
        style={{
          height: 56,
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "0 20px",
          background: chrome,
          borderBottom: `1px solid ${border}`,
        }}
      >
        <div style={{ display: "flex", gap: 10 }}>
          {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
            <div key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c }} />
          ))}
        </div>
        <div
          style={{
            flex: 1,
            maxWidth: 640,
            margin: "0 auto",
            height: 34,
            borderRadius: 17,
            background: dark ? "#0E1219" : "#FFFFFF",
            border: `1px solid ${border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 17,
            color: text,
          }}
        >
          {url}
        </div>
        <div style={{ width: 62 }} />
      </div>
      <div style={{ position: "relative", width: "100%", height: height - 56, overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
};
