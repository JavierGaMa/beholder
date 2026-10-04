import { useId } from "react";
import type { InputHTMLAttributes } from "react";
import clsx from "clsx";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label?: string;
};

export function Checkbox({ label, className, id, ...rest }: CheckboxProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        id={inputId}
        type="checkbox"
        className={clsx(
          "focus-ring h-3.5 w-3.5 shrink-0 cursor-default accent-[var(--accent)]",
          "disabled:pointer-events-none disabled:opacity-40",
          className,
        )}
        {...rest}
      />
      {label && (
        <label htmlFor={inputId} className="cursor-default text-[12px] text-txt">
          {label}
        </label>
      )}
    </span>
  );
}
