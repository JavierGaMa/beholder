import { nextMenuIndex } from "../../components/ui/menuNav";

export type SettingsSectionId = "appearance" | "agent-bridge" | "console" | "devices" | "about";

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "appearance", label: "Appearance" },
  { id: "agent-bridge", label: "Agent Bridge" },
  { id: "console", label: "Console" },
  { id: "devices", label: "Devices" },
  { id: "about", label: "About" },
];

export function nextSectionId(current: SettingsSectionId, key: string): SettingsSectionId {
  const ids = SETTINGS_SECTIONS.map((s) => s.id);
  const normalized =
    key === "ArrowRight" ? "ArrowDown" : key === "ArrowLeft" ? "ArrowUp" : key;
  const next = nextMenuIndex(normalized, ids.indexOf(current), ids.map(() => true));
  return ids[next] ?? current;
}

let remembered: SettingsSectionId | null = null;

export function rememberActiveSection(id: SettingsSectionId): void {
  remembered = id;
}

export function lastActiveSection(): SettingsSectionId | null {
  return remembered;
}
