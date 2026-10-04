import clsx from "clsx";

export type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  id?: string;
  className?: string;
};

export function Toggle({ checked, onChange, disabled, label, id, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "focus-ring relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border",
        "transition-colors [transition-duration:var(--dur-base)] disabled:pointer-events-none disabled:opacity-40",
        checked ? "border-transparent bg-accent" : "border-line bg-surface-2",
        className,
      )}
    >
      <span
        className={clsx(
          "absolute left-[2px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full",
          "transition-transform ease-[var(--ease-out)] [transition-duration:var(--dur-base)]",
          checked ? "translate-x-[14px] bg-accent-fg" : "bg-muted",
        )}
      />
    </button>
  );
}
