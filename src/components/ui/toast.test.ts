import { beforeEach, describe, expect, it } from "vitest";
import { useToasts } from "./toast";

beforeEach(() => {
  useToasts.setState({ items: [] });
});

describe("toasts", () => {
  it("pushes a toast with a default accent tone", () => {
    useToasts.getState().push("Copied line");
    const items = useToasts.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ text: "Copied line", tone: "accent" });
  });

  it("dismisses by id and keeps at most four stacked", () => {
    for (let i = 0; i < 6; i++) useToasts.getState().push(`t${i}`);
    let items = useToasts.getState().items;
    expect(items).toHaveLength(4);
    expect(items[0].text).toBe("t2");
    const id = items[0].id;
    useToasts.getState().dismiss(id);
    items = useToasts.getState().items;
    expect(items).toHaveLength(3);
    expect(items.every((t) => t.id !== id)).toBe(true);
  });
});
