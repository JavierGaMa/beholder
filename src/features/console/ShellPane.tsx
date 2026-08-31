import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { RotateCw } from "lucide-react";
import { invoke, isTauri } from "../../lib/tauri";
import { decodeChunks } from "./shellcodec";

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function terminalTheme(): ITheme {
  return {
    background: cssVar("--bg", "#0a0a0b"),
    foreground: cssVar("--txt", "#f4f4f5"),
    cursor: cssVar("--accent", "#22d3ee"),
    cursorAccent: cssVar("--bg", "#0a0a0b"),
    selectionBackground: cssVar("--surface-2", "#17171a"),
  };
}

export function ShellPane({ serial }: { serial: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [exited, setExited] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restartKey, setRestartKey] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isTauri) return;

    const term = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12,
      cursorBlink: true,
      scrollback: 5000,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    function fitNow(): boolean {
      try {
        fit.fit();
        return true;
      } catch {
        return false;
      }
    }

    fitNow();
    term.focus();

    const startingRef = { current: false };
    const encoder = new TextEncoder();

    term.onData((data) => {
      if (startingRef.current) return;
      const bytes = Array.from(encoder.encode(data));
      invoke("console_shell_input", { bytes }).catch(() => {});
    });

    const onResize = () => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      if (!fitNow()) return;
      if (term.rows > 0 && term.cols > 0) {
        invoke("console_shell_resize", { rows: term.rows, cols: term.cols }).catch(() => {});
      }
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(container);

    const unlisteners: Array<() => void> = [];
    let disposed = false;

    async function registerListeners() {
      const { listen } = await import("@tauri-apps/api/event");
      const unBytes = await listen<string[]>("console-shell-bytes", (e) => {
        term.write(decodeChunks(e.payload));
      });
      const unExit = await listen<{ code: number | null }>("console-shell-exit", (e) => {
        if (startingRef.current) return;
        setExited(true);
        setExitCode(e.payload.code);
      });
      if (disposed) {
        unBytes();
        unExit();
        return;
      }
      unlisteners.push(unBytes, unExit);
    }
    void registerListeners();

    async function start() {
      startingRef.current = true;
      setExited(false);
      setExitCode(null);
      setError(null);
      try {
        await invoke("console_shell_start", { serial, rows: term.rows, cols: term.cols });
        startingRef.current = false;
        term.focus();
      } catch (e) {
        startingRef.current = false;
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    void start();

    return () => {
      disposed = true;
      observer.disconnect();
      for (const un of unlisteners) un();
      term.dispose();
      invoke("console_shell_stop").catch(() => {});
    };
  }, [serial, restartKey]);

  function reconnect() {
    setRestartKey((k) => k + 1);
  }

  return (
    <div className="relative h-full w-full bg-bg">
      <div ref={containerRef} className="h-full w-full p-1" />
      {(exited || error != null) && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-bg/85">
          <span className="max-w-[80%] truncate font-mono text-[12px] text-muted" title={error ?? undefined}>
            {error != null
              ? error
              : exitCode != null
                ? `Shell exited (code ${exitCode})`
                : "Shell exited"}
          </span>
          <button
            type="button"
            onClick={reconnect}
            className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-fg"
          >
            <RotateCw size={11} /> Reconnect
          </button>
        </div>
      )}
    </div>
  );
}
