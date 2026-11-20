import { useCallback, useId, useMemo, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import clsx from "clsx";
import { Search } from "lucide-react";
import { useOverlayFocus } from "../../components/ui/useOverlayFocus";
import { usePalette } from "./store";
import { PALETTE_SECTIONS, searchCommands, type PaletteCommand } from "./commands";

export interface PaletteMenuProps {
  listId: string;
  query: string;
  results: PaletteCommand[];
  activeIndex: number;
  onQueryChange: (q: string) => void;
  onInputKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  onHoverIndex: (index: number) => void;
  onRun: (cmd: PaletteCommand) => void;
}

export function PaletteMenu({
  listId,
  query,
  results,
  activeIndex,
  onQueryChange,
  onInputKeyDown,
  onHoverIndex,
  onRun,
}: PaletteMenuProps) {
  const activeId = results[activeIndex] ? `${listId}-opt-${activeIndex}` : undefined;

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3">
        <Search size={14} className="shrink-0 text-muted" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Type a command..."
          aria-label="Search commands"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          className="h-9 w-full bg-transparent text-[12px] text-txt outline-none placeholder:text-muted/60"
        />
        <kbd className="shrink-0 rounded border border-line px-1 py-px font-mono text-[9px] leading-none text-muted/60">
          esc
        </kbd>
      </div>
      <div id={listId} role="listbox" aria-label="Commands" className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {results.length === 0 && (
          <p className="px-3 py-6 text-center text-[12px] text-muted">No matching commands</p>
        )}
        {PALETTE_SECTIONS.map((section) => {
          const items = results
            .map((cmd, index) => ({ cmd, index }))
            .filter((r) => r.cmd.section === section);
          if (items.length === 0) return null;
          return (
            <div key={section} role="group" aria-label={section}>
              <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-muted">
                {section}
              </p>
              {items.map(({ cmd, index }) => {
                const Icon = cmd.icon;
                const active = index === activeIndex;
                return (
                  <div
                    key={cmd.id}
                    id={`${listId}-opt-${index}`}
                    role="option"
                    aria-selected={active}
                    tabIndex={-1}
                    onMouseEnter={() => onHoverIndex(index)}
                    onClick={() => onRun(cmd)}
                    className={clsx(
                      "press flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium",
                      active ? "bg-accent/10 text-accent" : "text-txt hover:bg-surface-2",
                    )}
                  >
                    <Icon size={14} className="shrink-0" />
                    <span className="truncate">{cmd.label}</span>
                    {cmd.shortcut && (
                      <span className="ml-auto rounded border border-line px-1 py-px font-mono text-[9px] leading-none text-muted/60">
                        {cmd.shortcut}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function Palette({ commands }: { commands: PaletteCommand[] }) {
  const open = usePalette((s) => s.open);
  const query = usePalette((s) => s.query);
  const activeIndex = usePalette((s) => s.activeIndex);
  const recent = usePalette((s) => s.recent);
  const setQuery = usePalette((s) => s.setQuery);
  const setActiveIndex = usePalette((s) => s.setActiveIndex);
  const moveActive = usePalette((s) => s.moveActive);
  const recordRun = usePalette((s) => s.recordRun);
  const close = useCallback(() => usePalette.getState().setOpen(false), []);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  useOverlayFocus(open, close, panelRef);

  const results = useMemo(
    () => searchCommands(commands, query, recent),
    [commands, query, recent],
  );

  function onInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      moveActive(e.key, results.length);
      return;
    }
    if (e.key === "Enter") {
      const cmd = results[activeIndex];
      if (!cmd) return;
      e.preventDefault();
      execute(cmd);
    }
  }

  function execute(cmd: PaletteCommand) {
    recordRun(cmd.id);
    close();
    cmd.run();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-center px-4 pt-[10vh]">
      <div className="anim-overlay-fade absolute inset-0 bg-black/40" onClick={close} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="anim-pop-in relative flex max-h-[60vh] w-full max-w-md flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-bg shadow-[var(--shadow-3)] outline-none"
      >
        <PaletteMenu
          listId={listId}
          query={query}
          results={results}
          activeIndex={activeIndex}
          onQueryChange={setQuery}
          onInputKeyDown={onInputKeyDown}
          onHoverIndex={setActiveIndex}
          onRun={execute}
        />
      </div>
    </div>
  );
}
