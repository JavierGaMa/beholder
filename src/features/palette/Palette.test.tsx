import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PaletteMenu } from "./Palette";
import { buildPaletteCommands, searchCommands } from "./commands";

const commands = buildPaletteCommands({
  toggleSidebar: () => {},
  toggleFollow: () => {},
  focusSearch: () => {},
});

function renderMenu(query: string, activeIndex = 0) {
  return renderToStaticMarkup(
    <PaletteMenu
      listId="cmd-list"
      query={query}
      results={searchCommands(commands, query)}
      activeIndex={activeIndex}
      onQueryChange={() => {}}
      onInputKeyDown={() => {}}
      onHoverIndex={() => {}}
      onRun={() => {}}
    />,
  );
}

describe("PaletteMenu", () => {
  it("renders a combobox input with a visible placeholder", () => {
    const html = renderMenu("");
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="cmd-list"');
    expect(html).toContain("Type a command");
  });

  it("renders a listbox with grouped sections and shortcut hints", () => {
    const html = renderMenu("");
    expect(html).toContain('role="listbox"');
    expect(html).toContain('role="option"');
    expect(html).toContain('aria-label="Navigate"');
    expect(html).toContain('aria-label="Actions"');
    expect(html).toContain("Go to Requests");
    expect(html).toContain("Clear Requests");
    expect(html).toContain(">1</span>");
  });

  it("marks exactly one option as selected and references it from the input", () => {
    const html = renderMenu("", 1);
    const active = html.match(/id="(cmd-list-opt-\d+)"[^>]*aria-selected="true"/);
    const referenced = html.match(/aria-activedescendant="([^"]+)"/);
    expect(active).not.toBeNull();
    expect(referenced).not.toBeNull();
    expect(referenced?.[1]).toBe(active?.[1]);
    expect(html.match(/aria-selected="true"/g)?.length).toBe(1);
  });

  it("filters options by query", () => {
    const html = renderMenu("set");
    expect(html).toContain("Open Settings");
    expect(html).not.toContain("Go to Requests");
  });

  it("shows an empty state when nothing matches", () => {
    const html = renderMenu("zzz");
    expect(html).toContain("No matching commands");
    expect(html).not.toContain('role="option"');
  });
});
