import { useId } from "react";
import type { ComponentType, InputHTMLAttributes, Ref } from "react";
import clsx from "clsx";

export type ControlIcon = ComponentType<{ size?: number; className?: string }>;

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  mono?: boolean;
  trailingIcon?: ControlIcon;
  ref?: Ref<HTMLInputElement>;
};

export function Input({
  label,
  mono,
  trailingIcon: Trailing,
  className,
  id,
  ref,
  ...rest
}: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="flex w-full flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-[11px] leading-none text-muted">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          ref={ref}
          className={clsx(
            "focus-ring h-[30px] w-full rounded-[8px] bg-surface-2 px-3 text-[12px] text-txt",
            "placeholder:text-muted transition-shadow [transition-duration:var(--dur-fast)] focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_45%,transparent)]",
            "disabled:pointer-events-none disabled:opacity-40",
            mono && "font-mono",
            Trailing && "pr-7",
            className,
          )}
          {...rest}
        />
        {Trailing && (
          <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 text-muted">
            <Trailing size={14} />
          </span>
        )}
      </div>
    </div>
  );
}
