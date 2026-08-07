import { AxisBottom, AxisLeft } from "@visx/axis";
import { curveMonotoneX } from "@visx/curve";
import { localPoint } from "@visx/event";
import { LinearGradient } from "@visx/gradient";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import { useTooltip, useTooltipInPortal } from "@visx/tooltip";
import { bisector, extent } from "d3-array";
import { timeFormat } from "d3-time-format";
import { eur, points } from "./data";
import type { Point } from "./data";
import { useSize } from "./useSize";

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const bisect = bisector<Point, Date>((d) => d.date).left;

export function VisxChart() {
  const [host, width] = useSize<HTMLDivElement>();
  const height = host.current?.clientHeight ?? 290;
  const margin = { top: 8, right: 8, bottom: 26, left: 52 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = height - margin.top - margin.bottom;
  const x = scaleTime({ domain: extent(points, (d) => d.date) as [Date, Date], range: [0, innerW] });
  const y = scaleLinear({ domain: [90_000, Math.max(...points.map((d) => d.portfolio)) * 1.02], range: [innerH, 0], nice: true });
  const { tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip } = useTooltip<Point>();
  const { containerRef, TooltipInPortal } = useTooltipInPortal({ detectBounds: true, scroll: true });
  const onMove = (event: React.PointerEvent<SVGRectElement>) => {
    const point = localPoint(event);
    if (!point) return;
    const date = x.invert(point.x - margin.left);
    const index = Math.min(points.length - 1, Math.max(0, bisect(points, date)));
    const datum = points[index];
    showTooltip({ tooltipData: datum, tooltipLeft: x(datum.date) + margin.left, tooltipTop: y(datum.portfolio) + margin.top });
  };

  return <div ref={host} style={{ width: "100%", height: "100%" }}>
    {width > 0 && <svg ref={containerRef} width={width} height={height} role="img" aria-label="Portfolio value and benchmark from 2021 to 2026">
      <LinearGradient id="portfolio-fill" from={css("--prototype-portfolio")} to={css("--prototype-portfolio")} fromOpacity={0.2} toOpacity={0} />
      <Group left={margin.left} top={margin.top}>
        <GridRows scale={y} width={innerW} stroke={css("--prototype-grid")} />
        <AreaClosed data={points} x={(d) => x(d.date)} y={(d) => y(d.portfolio)} yScale={y} curve={curveMonotoneX} fill="url(#portfolio-fill)" />
        <LinePath data={points} x={(d) => x(d.date)} y={(d) => y(d.portfolio)} curve={curveMonotoneX} stroke={css("--prototype-portfolio")} strokeWidth={2} />
        <LinePath data={points} x={(d) => x(d.date)} y={(d) => y(d.benchmark)} curve={curveMonotoneX} stroke={css("--prototype-benchmark")} strokeWidth={1.5} strokeDasharray="5 4" />
        <AxisBottom top={innerH} scale={x} numTicks={width < 430 ? 3 : 6} tickFormat={(d) => timeFormat("%Y")(d as Date)} stroke="transparent" tickStroke="transparent" tickLabelProps={{ fill: css("--prototype-muted"), fontSize: 10, textAnchor: "middle" }} />
        <AxisLeft scale={y} numTicks={5} tickFormat={(v) => `€${Math.round(Number(v) / 1000)}k`} stroke="transparent" tickStroke="transparent" tickLabelProps={{ fill: css("--prototype-muted"), fontSize: 10, textAnchor: "end", dx: -5, dy: 3 }} />
      </Group>
      <rect x={margin.left} y={margin.top} width={innerW} height={innerH} fill="transparent" onPointerMove={onMove} onPointerLeave={hideTooltip} />
      {tooltipData && <circle cx={x(tooltipData.date) + margin.left} cy={y(tooltipData.portfolio) + margin.top} r={4} fill={css("--prototype-focus")} />}
    </svg>}
    {tooltipData && <TooltipInPortal left={tooltipLeft} top={tooltipTop} className="tooltip"><p className="tooltip-date">{tooltipData.date.toLocaleDateString("en-GB")}</p><p>Portfolio {eur.format(tooltipData.portfolio)}</p><p>Benchmark {eur.format(tooltipData.benchmark)}</p></TooltipInPortal>}
  </div>;
}
