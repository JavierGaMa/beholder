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
  primary: "border-transparent bg-accent text-accent-fg hover:brightness-110",
  ghost: "border-transparent text-muted hover:bg-surface-2 hover:text-txt",
  subtle: "border-transparent bg-surface-2 text-txt hover:brightness-110",
  danger: "border-transparent text-danger hover:bg-danger/10",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 px-2.5 text-[12px]",
  md: "h-8 gap-1.5 px-3 text-[12px]",
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
        "press focus-ring inline-flex items-center justify-center rounded-[var(--radius-md)] border font-medium",
        "transition-colors [transition-duration:var(--dur-fast)] disabled:pointer-events-none disabled:opacity-40",
        variants[variant],
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
