import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { HttpExchange, RoutedTo } from "../../store/types";

vi.stubGlobal("window", {});
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });

const { RequestRow } = await import("./RequestRow");
const { DetailPane } = await import("./DetailPane");

function exchange(routed?: RoutedTo): HttpExchange {
  return {
    id: 1,
    request: {
      method: "GET",
      url: "https://api.example.com/v1/orders/items",
      host: "api.example.com",
      path: "/v1/orders/items",
      headers: [],
      body: null,
      started_at: 1,
      routed,
    },
    response: null,
    error: null,
    timing: { ttfb_ms: null, download_ms: null, total_ms: null },
    protocol: "HTTP/1.1",
  };
}

const routed = { route_id: "orders", target: "http://127.0.0.1:4000" };

function row(ex: HttpExchange, hideDomain = false) {
  return renderToStaticMarkup(
    <RequestRow
      ex={ex}
      selected={false}
      flash={false}
      slowMs={500}
      hideDomain={hideDomain}
      range={{ start: 0, end: 1, seconds: 1 }}
      onSelect={() => {}}
      onContextMenu={() => {}}
      style={{}}
    />,
  );
}

function detail(ex: HttpExchange) {
  return renderToStaticMarkup(<DetailPane ex={ex} onClose={() => {}} onCollapse={() => {}} />);
}

describe("routed request marks", () => {
  it("tags a routed row with the target before the path", () => {
    for (const hideDomain of [false, true]) {
      const html = row(exchange(routed), hideDomain);
      expect(html).toMatch(/<span[^>]*title="http:\/\/127\.0\.0\.1:4000"[^>]*>local<\/span>/);
      expect(html.indexOf(">local<")).toBeLessThan(html.indexOf("/v1/orders/items"));
    }
  });

  it("leaves a plain row untagged", () => {
    expect(row(exchange())).not.toContain(">local<");
  });

  it("shows the route id and target in the detail pane", () => {
    const html = detail(exchange(routed));
    expect(html).toContain("Routed to");
    expect(html).toContain(">orders<");
    expect(html).toContain(">http://127.0.0.1:4000<");
  });

  it("omits the routed line for a plain request", () => {
    expect(detail(exchange())).not.toContain("Routed to");
  });
});
