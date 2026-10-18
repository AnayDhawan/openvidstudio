import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import Board from "./pages/index";
import Insights from "./pages/insights";

const path = window.location.pathname.replace(/\/$/, "") || "/";
const Page = path === "/insights" ? Insights : Board;
createRoot(document.getElementById("root")!).render(<Page path={path} />);
