import { invoke } from "../../lib/tauri";
import { loadBodyCapMb } from "../../lib/prefs";
import { useTraffic } from "../../store/traffic";

export async function startCapture(serial: string, command = "capture_start"): Promise<void> {
  const port = await invoke<number>(command, {
    serial,
    bodyCap: Math.round(loadBodyCapMb() * 1024 * 1024),
  });
  useTraffic.getState().setCapture(true, port);
}
