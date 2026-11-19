export interface SchemeMediaQuery {
  matches: boolean;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export type SchemeMatchMedia = (query: string) => SchemeMediaQuery;

export interface SystemSchemeWatch {
  update(mode: string, reapply: () => void): void;
  dispose(): void;
}

export function createSystemSchemeWatch(matchMedia: SchemeMatchMedia): SystemSchemeWatch {
  let media: SchemeMediaQuery | null = null;
  let listener: (() => void) | null = null;
  let reapply: (() => void) | null = null;

  return {
    update(mode: string, nextReapply: () => void) {
      reapply = nextReapply;
      if (mode !== "system") {
        if (media && listener) media.removeEventListener("change", listener);
        media = null;
        listener = null;
        return;
      }
      if (!media) {
        media = matchMedia("(prefers-color-scheme: dark)");
        listener = () => reapply?.();
        media.addEventListener("change", listener);
      }
    },
    dispose() {
      if (media && listener) media.removeEventListener("change", listener);
      media = null;
      listener = null;
      reapply = null;
    },
  };
}
