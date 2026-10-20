export interface BarRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildBarRects(values: number[], width: number, height: number): BarRect[] {
  if (values.length === 0) return [];
  const slot = width / values.length;
  const barW = round2(slot * 0.7);
  const inset = slot * 0.15;
  const max = Math.max(...values);
  return values.map((value, i) => {
    const h = max > 0 ? round2((value / max) * height) : 0;
    return {
      x: round2(i * slot + inset),
      y: round2(height - h),
      w: barW,
      h,
    };
  });
}

export function buildLinePath(values: number[], width: number, height: number): string {
  if (values.length === 0) return "";
  const max = Math.max(...values);
  const y = (v: number) => (max > 0 ? round2(height - (v / max) * height) : height);
  if (values.length === 1) {
    return `M 0 ${y(values[0])} L ${width} ${y(values[0])}`;
  }
  const step = width / (values.length - 1);
  return values
    .map((v, i) => `${i === 0 ? "M" : "L"} ${round2(i * step)} ${y(v)}`)
    .join(" ");
}

export function BucketBars({
  values,
  width = 560,
  height = 96,
  fill = "var(--accent)",
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  fill?: string;
  label?: string;
}) {
  const rects = buildBarRects(values, width, height);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="h-full w-full"
    >
      {rects.map((rect, i) => (
        <rect key={i} x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill={fill} rx={1} />
      ))}
    </svg>
  );
}
