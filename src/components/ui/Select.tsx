import { useId } from "react";
import type { Ref, SelectHTMLAttributes } from "react";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  ref?: Ref<HTMLSelectElement>;
};

export function Select({ label, className, id, children, ref, ...rest }: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className="flex w-full flex-col gap-1">
      {label && (
        <label htmlFor={selectId} className="text-[11px] leading-none text-muted">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          ref={ref}
          className={clsx(
            "focus-ring h-7 w-full appearance-none rounded-[var(--radius-md)] border border-line bg-surface-2 pl-2 pr-7 text-[12px] text-txt",
            "transition-colors [transition-duration:var(--dur-fast)] focus:border-accent",
            "disabled:pointer-events-none disabled:opacity-40",
            className,
          )}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted"
        />
      </div>
    </div>
  );
}
