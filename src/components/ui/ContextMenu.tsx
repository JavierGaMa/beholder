import type { ComponentType } from "react";
import { Menu } from "./Menu";
import type { MenuOption } from "./Menu";

export interface MenuItem {
  label: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const options: MenuOption[] = items.map((item) => ({
    key: item.label,
    label: item.label,
    icon: item.icon,
    disabled: item.disabled,
    danger: item.danger,
    onSelect: item.onSelect,
  }));
  return <Menu x={x} y={y} items={options} onClose={onClose} />;
}
