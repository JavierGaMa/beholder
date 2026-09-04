export interface ColorOverrides {
  bg?: string | null;
  surface?: string | null;
  surface_2?: string | null;
  line?: string | null;
  text?: string | null;
  muted?: string | null;
  accent?: string | null;
  ok?: string | null;
  warn?: string | null;
  danger?: string | null;
}

export interface ConsoleConfig {
  ring_lines: number;
  show_tid: boolean;
  default_buffer: string;
}

export interface ApksConfig {
  list_url: string;
}

export interface UiConfig {
  theme: string;
  accent: string;
  ui_font_size: number;
  mono_font_size: number;
  row_height: number;
  mono_font_family?: string | null;
  colors?: ColorOverrides;
  console?: ConsoleConfig;
  apks?: ApksConfig;
}

export const DEFAULT_CONFIG: UiConfig = {
  theme: "contrast",
  accent: "lime",
  ui_font_size: 13,
  mono_font_size: 12,
  row_height: 34,
  mono_font_family: null,
  colors: {},
  console: { ring_lines: 10000, show_tid: false, default_buffer: "main" },
  apks: {
    list_url: "",
  },
};
