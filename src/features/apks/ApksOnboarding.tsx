import { useState } from "react";
import { AlertCircle, CircleCheck, Loader2 } from "lucide-react";
import { invoke } from "../../lib/tauri";
import { errorText } from "../../store/cached";
import { toast } from "../../components/ui/toast";
import {
  applyApksTestResult,
  canSaveApks,
  type ApksTestResult,
  type ApksTestState,
} from "./apksOnboardingState";

const URL_PLACEHOLDER =
  "https://<account>.blob.core.windows.net/<container>?restype=container&comp=list&prefix=APKs/";

export function ApksOnboarding({ onSaved }: { onSaved: () => void }) {
  const [url, setUrl] = useState("");
  const [test, setTest] = useState<ApksTestState>({ phase: "idle" });
  const [saving, setSaving] = useState(false);

  const canTest = url.trim() !== "" && test.phase !== "testing";
  const canSave = canSaveApks(test, url) && !saving;

  async function runTest() {
    const trimmed = url.trim();
    setTest({ phase: "testing", url: trimmed });
    let result: ApksTestResult;
    try {
      result = await invoke<ApksTestResult>("test_apks_list_url", { listUrl: url });
    } catch (e) {
      result = { ok: false, error: errorText(e) };
    }
    setTest((cur) => applyApksTestResult(cur, trimmed, result));
  }

  async function save() {
    setSaving(true);
    try {
      await invoke("set_apks_config", { listUrl: url });
      onSaved();
    } catch (e) {
      toast(errorText(e), "danger");
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-line bg-surface p-5">
      <p className="text-sm font-semibold text-txt">Connect your builds source</p>
      <p className="mt-0.5 text-[12px] text-muted">
        Point Beholder at an Azure Blob container listing and your published APKs will show up
        here, ready to install on any emulator.
      </p>

      <label className="mt-4 block text-[11px] font-medium uppercase tracking-wider text-muted/70">
        Container list URL
      </label>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={URL_PLACEHOLDER}
        spellCheck={false}
        className="mt-1.5 h-8 w-full rounded-md border border-line bg-bg px-2 font-mono text-[12px] text-txt placeholder:text-muted/60 focus:border-accent focus:outline-none"
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void runTest()}
          disabled={!canTest}
          className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] font-medium text-txt hover:border-accent disabled:opacity-40 disabled:hover:border-line"
        >
          {test.phase === "testing" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : null}
          Test connection
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          className="flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-[12px] font-semibold text-accent-fg transition-transform hover:scale-[1.01] disabled:opacity-40 disabled:hover:scale-100"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : null}
          Save
        </button>
      </div>

      {test.phase === "ok" && (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] font-medium text-ok">
          <CircleCheck size={13} /> {test.count} builds found
        </p>
      )}
      {test.phase === "failed" && (
        <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 p-3">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-danger">
            <AlertCircle size={13} /> Connection failed
          </p>
          <p
            className="mt-1 break-all font-mono text-[11px] text-danger/80"
            title={test.error}
          >
            {test.error}
          </p>
        </div>
      )}
    </div>
  );
}
