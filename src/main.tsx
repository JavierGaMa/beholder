import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyTheme, loadTheme } from "./lib/theme/themes";
import "./styles/theme.css";

const { theme, accent } = loadTheme();
applyTheme(theme, accent);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
