import type { ButtonHTMLAttributes, ComponentType, Ref } from "react";
import clsx from "clsx";

export type ButtonVariant = "primary" | "ghost" | "subtle" | "danger";
export type ButtonSize = "sm" | "md" | "icon";

export type ButtonIcon = ComponentType<{ size?: number; className?: string }>;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ButtonIcon;
  ref?: Ref<HTMLButtonElement>;
};

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent font-semibold text-accent-fg hover:brightness-110",
  ghost: "bg-transparent font-medium text-muted hover:bg-surface-2 hover:text-txt",
  subtle: "bg-surface-2 font-medium text-txt hover:brightness-110",
  danger: "bg-transparent font-medium text-danger hover:bg-danger/10",
};

const GHOST_RING = "shadow-[inset_0_0_0_1px_var(--line)]";

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 px-2.5 text-[12px]",
  md: "h-7 gap-1.5 px-3 text-[12px]",
  icon: "h-7 w-7 p-0",
};

export function Button({
  variant = "ghost",
  size = "md",
  icon: Icon,
  className,
  children,
  type = "button",
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      ref={ref}
      className={clsx(
        "press focus-ring inline-flex items-center justify-center rounded-[8px]",
        "transition-colors [transition-duration:var(--dur-fast)] disabled:pointer-events-none disabled:opacity-40",
        variants[variant],
        variant === "ghost" && size !== "icon" && GHOST_RING,
        sizes[size],
        className,
      )}
      {...rest}
    >
      {Icon && <Icon size={size === "md" ? 15 : 14} className="shrink-0" />}
      {children}
    </button>
  );
}
