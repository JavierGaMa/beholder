import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { queryClient } from "./lib/query";
import { applyTheme, loadTheme } from "./lib/theme/themes";
import "./styles/theme.css";

const { theme, accent } = loadTheme();
applyTheme(theme, accent);

document.documentElement.dataset.platform = /Mac/i.test(navigator.userAgent) ? "macos" : "other";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
