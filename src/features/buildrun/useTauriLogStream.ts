import { useEffect, useState } from "react";
import { isTauri } from "../../lib/tauri";
import type { LogPage } from "./logStream";
import { EMPTY_LOG, appendLog } from "./logStream";

export function useTauriLogStream(event: string, resetKey: number): LogPage {
  const [page, setPage] = useState<LogPage>(EMPTY_LOG);

  useEffect(() => {
    setPage(EMPTY_LOG);
  }, [event, resetKey]);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/event").then(({ listen }) =>
      listen<string>(event, (e) => {
        setPage((p) => appendLog(p, e.payload));
      }).then((un) => {
        if (cancelled) un();
        else unlisten = un;
      }),
    );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [event]);

  return page;
}
