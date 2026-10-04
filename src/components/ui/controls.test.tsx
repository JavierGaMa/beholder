import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./Button";
import { Chip } from "./Chip";
import { SegmentedControl } from "./SegmentedControl";
import { Toggle } from "./Toggle";

describe("Button", () => {
  it("applies primary variant classes", () => {
    const html = renderToStaticMarkup(<Button variant="primary">Save</Button>);
    expect(html).toContain("bg-accent");
    expect(html).toContain("text-accent-fg");
    expect(html).toContain("rounded-[var(--radius-md)]");
  });

  it("applies ghost variant classes", () => {
    const html = renderToStaticMarkup(<Button variant="ghost">Cancel</Button>);
    expect(html).toContain("text-muted");
    expect(html).toContain("hover:bg-surface-2");
  });

  it("applies subtle variant classes", () => {
    const html = renderToStaticMarkup(<Button variant="subtle">Copy</Button>);
    expect(html).toContain("bg-surface-2");
    expect(html).toContain("text-txt");
  });

  it("applies danger variant classes", () => {
    const html = renderToStaticMarkup(<Button variant="danger">Delete</Button>);
    expect(html).toContain("text-danger");
    expect(html).toContain("hover:bg-danger/10");
  });

  it("applies size geometry", () => {
    const sm = renderToStaticMarkup(<Button size="sm">Go</Button>);
    expect(sm).toContain("h-7");
    expect(sm).toContain("px-2.5");
    expect(sm).toContain("text-[12px]");
    expect(renderToStaticMarkup(<Button size="md">Go</Button>)).toContain("h-8");
    const icon = renderToStaticMarkup(<Button size="icon">x</Button>);
    expect(icon).toContain("w-7");
    expect(icon).toContain("h-7");
    expect(icon).toContain("p-0");
  });

  it("renders a leading icon and focus, press, and disabled affordances", () => {
    const Icon = () => <svg />;
    const html = renderToStaticMarkup(
      <Button variant="primary" icon={Icon} disabled>
        Save
      </Button>,
    );
    expect(html).toContain("<svg");
    expect(html).toContain("focus-ring");
    expect(html).toContain("press");
    expect(html).toContain("disabled:opacity-40");
    expect(html).toContain('disabled=""');
  });
});

describe("Toggle", () => {
  it("renders a switch role with aria-checked false", () => {
    const html = renderToStaticMarkup(<Toggle checked={false} onChange={() => {}} />);
    expect(html).toMatch(/<button[^>]*role="switch"/);
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain("h-[18px]");
    expect(html).toContain("w-8");
  });

  it("reflects the checked state on aria-checked and the knob position", () => {
    const html = renderToStaticMarkup(<Toggle checked onChange={() => {}} />);
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("translate-x-[14px]");
    expect(html).toContain("bg-accent");
  });

  it("renders the unchecked track from surface tokens", () => {
    const html = renderToStaticMarkup(<Toggle checked={false} onChange={() => {}} />);
    expect(html).toContain("bg-surface-2");
    expect(html).toContain("border-line");
  });
});

describe("Chip", () => {
  it("styles unselected chips as muted with hover promotion", () => {
    const html = renderToStaticMarkup(<Chip>GET</Chip>);
    expect(html).toContain("border-line");
    expect(html).toContain("text-muted");
    expect(html).toContain("hover:text-txt");
    expect(html).toContain("hover:border-muted/40");
    expect(html).toContain('aria-pressed="false"');
  });

  it("styles selected chips with the accent tint", () => {
    const html = renderToStaticMarkup(<Chip selected>GET</Chip>);
    expect(html).toContain("bg-accent/15");
    expect(html).toContain("text-accent");
    expect(html).toContain("border-accent/30");
    expect(html).toContain('aria-pressed="true"');
  });

  it("renders an optional count badge", () => {
    const html = renderToStaticMarkup(
      <Chip selected count={12}>
        GET
      </Chip>,
    );
    expect(html).toContain(">12</span>");
  });
});

describe("SegmentedControl", () => {
  const options = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta" },
  ];

  it("renders a radiogroup with radio options", () => {
    const html = renderToStaticMarkup(
      <SegmentedControl options={options} value="b" onChange={() => {}} />,
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-checked="false"');
  });

  it("elevates the active option with surface and shadow-1", () => {
    const html = renderToStaticMarkup(
      <SegmentedControl options={options} value="b" onChange={() => {}} />,
    );
    expect(html).toContain("bg-surface-2");
    expect(html).toContain("bg-surface");
    expect(html).toContain("shadow-[var(--shadow-1)]");
    expect(html).toContain("text-muted");
  });

  it("keeps only the active option in the tab order", () => {
    const html = renderToStaticMarkup(
      <SegmentedControl options={options} value="a" onChange={() => {}} />,
    );
    const tabbables = html.match(/tabindex="0"/g) ?? [];
    expect(tabbables).toHaveLength(1);
  });
});
