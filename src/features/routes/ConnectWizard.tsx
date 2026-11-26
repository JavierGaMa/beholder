import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import clsx from "clsx";
import { FileCode2, Loader2, SearchX, TriangleAlert, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { ErrorBox } from "../../components/ui/ErrorBox";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Badge } from "../../components/ui/primitives";
import { useConnect, type ConnectStep } from "./connectStore";

const STEPS = ["1 Detect", "2 Choose", "3 Connect"];

const DISCOVERY_PATH = "/.well-known/beholder-routes";

type OpenStep = Exclude<ConnectStep, { kind: "closed" }>;
type StepOf<K extends OpenStep["kind"]> = Extract<OpenStep, { kind: K }>;

const INVALID_TITLES: Record<StepOf<"invalid">["problem"], string> = {
  file: "That file can't be used",
  response: "That service sent an invalid response",
  config: "config.toml couldn't be updated",
};

function activeStep(step: OpenStep): number {
  if (step.kind === "found") return step.connecting ? 2 : 1;
  if (step.kind === "invalid") return { response: 0, file: 1, config: 2 }[step.problem];
  return 0;
}

function Steps({ active }: { active: number }) {
  return (
    <ol aria-label="Progress" className="flex items-center gap-2 text-[11px]">
      {STEPS.map((label, index) => (
        <li key={label} className="flex items-center gap-2">
          {index > 0 && (
            <span aria-hidden="true" className="text-muted/60">
              ·
            </span>
          )}
          <span
            aria-current={index === active ? "step" : undefined}
            className={clsx(
              "rounded-full px-2 py-1 leading-none",
              index === active ? "bg-surface-2 font-semibold text-txt" : "text-muted",
            )}
          >
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">{children}</div>;
}

function Detecting({ step }: { step: StepOf<"detecting"> }) {
  const close = useConnect((s) => s.close);
  return (
    <>
      <div role="status" className="flex flex-col items-center gap-3 px-6 py-8 text-center">
        <Loader2 size={24} aria-hidden="true" className="animate-spin text-accent" />
        <p className="text-sm font-medium text-txt">Looking for local services…</p>
        <p className="max-w-full break-all font-mono text-[11px] text-muted">
          {`${step.address.replace(/\/$/, "")}${DISCOVERY_PATH}`}
        </p>
      </div>
      <Footer>
        <Button data-autofocus onClick={close}>
          Cancel
        </Button>
      </Footer>
    </>
  );
}

function Found({ step }: { step: StepOf<"found"> }) {
  const select = useConnect((s) => s.select);
  const connect = useConnect((s) => s.connect);
  const back = useConnect((s) => s.back);
  const group = useId();
  const { discovery, selected, connecting } = step;
  const chosen = discovery.files.find((file) => file.id === selected);
  const idle = chosen !== undefined && chosen.routes > 0 && chosen.up === 0;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        connect();
      }}
    >
      <div className="flex flex-col gap-3 px-4 py-4">
        <div className="flex min-w-0 items-center gap-2">
          <Badge tone="ok">Found</Badge>
          <span className="truncate text-[13px] font-semibold text-txt">{discovery.name}</span>
          <span className="ml-auto truncate font-mono text-[11px] text-muted">{discovery.address}</span>
        </div>
        <p id={`${group}-help`} className="text-[12px] text-muted">
          Choose one environment. Environments can share the same paths, so connect one at a time.
        </p>
        <div
          role="radiogroup"
          aria-label="Environments"
          aria-describedby={`${group}-help`}
          className="flex max-h-[38vh] flex-col gap-1.5 overflow-y-auto p-0.5"
        >
          {discovery.files.map((file) => {
            const checked = file.id === selected;
            return (
              <label
                key={file.id}
                className={clsx(
                  "flex shrink-0 items-start gap-3 rounded-[10px] border px-3 py-2",
                  checked ? "border-accent bg-accent/10" : "border-line bg-surface",
                  file.error === null && !checked && "cursor-pointer hover:bg-surface-2",
                  file.error === null && checked && "cursor-pointer",
                )}
              >
                <input
                  type="radio"
                  name={group}
                  value={file.id}
                  checked={checked}
                  disabled={file.error !== null || connecting}
                  onChange={() => select(file.id)}
                  data-autofocus={checked ? true : undefined}
                  className="mt-0.5 accent-accent disabled:opacity-40"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={clsx(
                      "text-[12px] font-semibold",
                      file.error === null ? "text-txt" : "text-muted",
                    )}
                  >
                    {file.label}
                  </span>
                  <span className="truncate font-mono text-[11px] text-muted" title={file.path}>
                    {file.path}
                  </span>
                  {file.error !== null && (
                    <span className="break-words text-[11px] text-danger">{file.error}</span>
                  )}
                </span>
                {file.error === null && (
                  <span
                    className={clsx(
                      "shrink-0 font-mono text-[11px] tabular-nums",
                      file.up > 0 ? "text-ok" : "text-muted",
                    )}
                  >
                    {`${file.up} of ${file.routes} running`}
                  </span>
                )}
              </label>
            );
          })}
        </div>
        {idle && (
          <div role="status" className="flex items-start gap-2 rounded-[10px] bg-warn/14 px-3 py-2 text-[12px]">
            <TriangleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-warn" />
            <div className="min-w-0 text-txt">
              <p className="font-semibold">{`No ${chosen.label} services are running.`}</p>
              {chosen.hint && (
                <p className="text-muted">
                  Start them with{" "}
                  <code className="break-all font-mono text-txt">{chosen.hint}</code>, or connect now and
                  start them later.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      <Footer>
        <Button data-autofocus={selected === null ? true : undefined} onClick={back}>
          Back
        </Button>
        <Button
          type="submit"
          variant="primary"
          icon={connecting ? Spinner : undefined}
          disabled={!chosen}
          aria-busy={connecting}
        >
          Connect
        </Button>
      </Footer>
    </form>
  );
}

function Spinner({ size }: { size?: number }) {
  return <Loader2 size={size} aria-hidden="true" className="animate-spin" />;
}

function Address({ step }: { step: StepOf<"address"> }) {
  const address = useConnect((s) => s.address);
  const setAddress = useConnect((s) => s.setAddress);
  const detect = useConnect((s) => s.detect);
  const chooseFile = useConnect((s) => s.chooseFile);
  const errorId = useId();
  function submit(e: FormEvent) {
    e.preventDefault();
    detect();
  }
  return (
    <div className="flex flex-col gap-4 px-4 py-5">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-muted">
          <SearchX size={18} aria-hidden="true" />
        </span>
        <p className="text-sm font-medium text-txt">
          {step.found ? "Look at another address" : "No local services found"}
        </p>
        <p className="max-w-full break-all font-mono text-[11px] text-muted">{step.address}</p>
      </div>
      <form onSubmit={submit} noValidate className="flex flex-col gap-2">
        <div className="flex items-end gap-2">
          <Input
            label="Address"
            mono
            data-autofocus
            value={address}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={step.invalid}
            aria-describedby={step.invalid ? errorId : undefined}
            onChange={(e) => setAddress(e.target.value)}
          />
          <Button type="submit" variant="primary" className="h-[30px] shrink-0">
            Try again
          </Button>
        </div>
        {step.invalid && (
          <p id={errorId} role="alert" className="text-[11px] text-danger">
            Use a local address, like http://localhost:8090
          </p>
        )}
      </form>
      <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
        <span className="text-[12px] text-muted">Already have a route file?</span>
        <Button size="sm" icon={FileCode2} onClick={chooseFile}>
          Choose file…
        </Button>
      </div>
    </div>
  );
}

function Invalid({ step }: { step: StepOf<"invalid"> }) {
  const back = useConnect((s) => s.back);
  const retry = useConnect((s) => s.retry);
  return (
    <>
      <div role="alert" className="flex flex-col gap-3 px-4 py-5">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-danger/14 text-danger">
            <TriangleAlert size={18} aria-hidden="true" />
          </span>
          <p className="text-sm font-medium text-txt">{INVALID_TITLES[step.problem]}</p>
        </div>
        <ErrorBox message={step.message} />
        <p className="break-all text-center font-mono text-[11px] text-muted">{step.target}</p>
      </div>
      <Footer>
        <Button onClick={back}>Back</Button>
        <Button variant="primary" data-autofocus onClick={retry}>
          {step.retry.action === "choose" ? "Choose another file" : "Try again"}
        </Button>
      </Footer>
    </>
  );
}

function StepBody({ step }: { step: OpenStep }) {
  if (step.kind === "detecting") return <Detecting step={step} />;
  if (step.kind === "found") return <Found step={step} />;
  if (step.kind === "address") return <Address step={step} />;
  return <Invalid step={step} />;
}

export function ConnectWizard() {
  const step = useConnect((s) => s.step);
  const close = useConnect((s) => s.close);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [step.kind]);
  if (step.kind === "closed") return null;
  return (
    <Modal open onClose={close} ariaLabel="Connect services" className="max-w-[480px]!">
      <div ref={bodyRef} className="flex flex-col">
        <header className="flex flex-col gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="flex-1 text-[13px] font-semibold text-txt">Connect services</h2>
            <Button size="icon" icon={X} aria-label="Close" onClick={close} />
          </div>
          <Steps active={activeStep(step)} />
        </header>
        <StepBody step={step} />
      </div>
    </Modal>
  );
}
