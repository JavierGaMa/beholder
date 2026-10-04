import { useState } from "react";
import { AlertCircle, CircleCheck, Loader2 } from "lucide-react";
import { invoke } from "../../lib/tauri";
import { qError } from "../../lib/query";
import { toast } from "../../components/ui/toast";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import {
  applyApksTestResult,
  canSaveApks,
  type ApksTestResult,
  type ApksTestState,
} from "./apksOnboardingState";

const URL_PLACEHOLDER =
  "https://<account>.blob.core.windows.net/<container>?restype=container&comp=list&prefix=APKs/";

export function ApksOnboarding({
  initialUrl,
  onSaved,
}: {
  initialUrl?: string;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
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
      result = { ok: false, error: qError(e) ?? String(e) };
    }
    setTest((cur) => applyApksTestResult(cur, trimmed, result));
  }

  async function save() {
    setSaving(true);
    try {
      await invoke("set_apks_config", { listUrl: url });
      onSaved();
    } catch (e) {
      toast(qError(e) ?? String(e), "danger");
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

      <div className="mt-4">
        <Input
          label="Container list URL"
          mono
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={URL_PLACEHOLDER}
          spellCheck={false}
        />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button variant="subtle" size="sm" onClick={() => void runTest()} disabled={!canTest}>
          {test.phase === "testing" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : null}
          Test connection
        </Button>
        <Button variant="primary" size="sm" onClick={() => void save()} disabled={!canSave}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          Save
        </Button>
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
