import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { niceScale, showAxisLabel, tickLabelInterval } from "../lib/chartScale";
import type { CampaignAnalyticsDay } from "../types";

export type ChartSeriesKey = "invitesSent" | "accepted" | "messagesSent" | "replies";

export const chartSeries: Array<{ key: ChartSeriesKey; label: string; className: string }> = [
  { key: "invitesSent", label: "Invites", className: "invite" },
  { key: "accepted", label: "Accepted", className: "accepted" },
  { key: "messagesSent", label: "Messages", className: "message" },
  { key: "replies", label: "Replies", className: "reply" }
];

const geometry = {
  axisWidth: 56,
  rightPadding: 16,
  topPadding: 16,
  plotHeight: 200,
  axisBand: 44,
  minSlot: 26,
  minPlotWidth: 620,
  maxBarWidth: 12,
  barGap: 2,
  tooltipWidth: 186
};

type DailyActivityChartProps = {
  days: CampaignAnalyticsDay[];
  visibleSeries: ChartSeriesKey[];
  timeZone: string;
};

export function DailyActivityChart({ days, visibleSeries, timeZone }: DailyActivityChartProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    setAvailableWidth(node.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setActiveIndex(null);
  }, [days, visibleSeries]);

  const series = chartSeries.filter((entry) => visibleSeries.includes(entry.key));
  const slots = Math.max(days.length, 1);
  const plotSpace = Math.max(availableWidth - geometry.axisWidth - geometry.rightPadding, geometry.minPlotWidth);
  const slotWidth = Math.max(geometry.minSlot, Math.floor(plotSpace / slots));
  const plotWidth = slotWidth * slots;
  const width = geometry.axisWidth + plotWidth + geometry.rightPadding;
  const height = geometry.topPadding + geometry.plotHeight + geometry.axisBand;
  const baseline = geometry.topPadding + geometry.plotHeight;

  const peak = days.length === 0
    ? 0
    : Math.max(0, ...days.flatMap((day) => series.map((entry) => day[entry.key])));
  const { domainMax, ticks } = niceScale(peak);
  const labelInterval = tickLabelInterval(slotWidth, slots);

  const barWidth = Math.max(3, Math.min(
    geometry.maxBarWidth,
    Math.floor((slotWidth - 8 - (series.length - 1) * geometry.barGap) / Math.max(series.length, 1))
  ));
  const groupWidth = series.length * barWidth + (series.length - 1) * geometry.barGap;

  const slotX = (index: number) => geometry.axisWidth + index * slotWidth;
  const valueY = (value: number) => baseline - (value / domainMax) * geometry.plotHeight;
  const activeDay = activeIndex === null ? null : days[activeIndex] ?? null;

  return (
    <div className="report-chart-scroll" ref={scrollRef}>
      <div className="report-chart-frame" style={{ width }} onMouseLeave={() => setActiveIndex(null)}>
        <svg className="report-chart-svg" width={width} height={height} role="img" aria-label={chartLabel(days, series)}>
          <text
            className="report-axis-caption"
            transform={`translate(12 ${geometry.topPadding + geometry.plotHeight / 2}) rotate(-90)`}
            textAnchor="middle"
          >
            Actions per day
          </text>

          {ticks.map((tick) => (
            <g key={`tick-${tick}`}>
              <line
                className={tick === 0 ? "report-axis-line" : "report-grid-line"}
                x1={geometry.axisWidth}
                x2={width - geometry.rightPadding}
                y1={valueY(tick)}
                y2={valueY(tick)}
              />
              <text className="report-axis-tick" x={geometry.axisWidth - 10} y={valueY(tick) + 4} textAnchor="end">
                {tick.toLocaleString()}
              </text>
            </g>
          ))}

          <line
            className="report-axis-line"
            x1={geometry.axisWidth}
            x2={geometry.axisWidth}
            y1={geometry.topPadding}
            y2={baseline}
          />

          {days.map((day, index) => {
            const groupStart = slotX(index) + (slotWidth - groupWidth) / 2;
            return (
              <g key={day.date}>
                {activeIndex === index ? (
                  <rect
                    className="report-column-highlight"
                    x={slotX(index)}
                    y={geometry.topPadding}
                    width={slotWidth}
                    height={geometry.plotHeight}
                  />
                ) : null}
                {series.map((entry, position) => {
                  const value = day[entry.key];
                  if (value <= 0) return null;
                  const barHeight = Math.max(2, (value / domainMax) * geometry.plotHeight);
                  return (
                    <path
                      key={entry.key}
                      className={`report-bar ${entry.className}`}
                      d={barPath(groupStart + position * (barWidth + geometry.barGap), baseline - barHeight, barWidth, barHeight)}
                    />
                  );
                })}
              </g>
            );
          })}

          {days.map((day, index) => (
            showAxisLabel(index, days.length, labelInterval) ? (
              <text
                key={`date-${day.date}`}
                className="report-axis-date"
                x={slotX(index) + slotWidth / 2}
                y={baseline + 19}
                textAnchor="middle"
              >
                {formatAxisDate(day.date)}
              </text>
            ) : null
          ))}

          {days.length > 0 ? (
            <text
              className="report-axis-caption"
              x={geometry.axisWidth + plotWidth / 2}
              y={baseline + 36}
              textAnchor="middle"
            >
              {`${formatChartDate(days[0].date)} – ${formatChartDate(days[days.length - 1].date)} · ${timeZone}`}
            </text>
          ) : null}

          {peak === 0 ? (
            <g>
              <text
                className="report-chart-empty-title"
                x={geometry.axisWidth + plotWidth / 2}
                y={geometry.topPadding + geometry.plotHeight / 2 - 4}
                textAnchor="middle"
              >
                {days.length === 0 ? "No days in this window" : "Nothing sent in this window"}
              </text>
              <text
                className="report-chart-empty-note"
                x={geometry.axisWidth + plotWidth / 2}
                y={geometry.topPadding + geometry.plotHeight / 2 + 18}
                textAnchor="middle"
              >
                Reports count live runs only — dry runs are never included.
              </text>
            </g>
          ) : null}

          {days.map((day, index) => (
            <g
              key={`hit-${day.date}`}
              className="report-column-hit"
              tabIndex={0}
              role="button"
              aria-label={columnLabel(day, series)}
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex(null)}
            >
              <rect
                x={slotX(index)}
                y={geometry.topPadding}
                width={slotWidth}
                height={geometry.plotHeight}
                fill="transparent"
              />
            </g>
          ))}
        </svg>

        {activeDay ? (
          <div
            className="report-tooltip"
            role="tooltip"
            style={{ left: tooltipCenter(slotX(activeIndex ?? 0) + slotWidth / 2, slotWidth, width) }}
          >
            <strong>{formatChartDate(activeDay.date)}</strong>
            {series.map((entry) => (
              <span key={entry.key}>
                <i className={entry.className} /> {entry.label}
                <b>{activeDay[entry.key].toLocaleString()}</b>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function barPath(x: number, y: number, barWidth: number, barHeight: number) {
  const radius = Math.min(3, barWidth / 2, barHeight);
  const bottom = y + barHeight;
  return [
    `M${x} ${bottom}`,
    `L${x} ${y + radius}`,
    `Q${x} ${y} ${x + radius} ${y}`,
    `L${x + barWidth - radius} ${y}`,
    `Q${x + barWidth} ${y} ${x + barWidth} ${y + radius}`,
    `L${x + barWidth} ${bottom}`,
    "Z"
  ].join(" ");
}

/** Park the tooltip beside the hovered column so it never covers the bars it explains. */
function tooltipCenter(columnCenter: number, slotWidth: number, chartWidth: number) {
  const offset = slotWidth / 2 + 12 + geometry.tooltipWidth / 2;
  const midpoint = geometry.axisWidth + (chartWidth - geometry.axisWidth) / 2;
  const preferred = columnCenter <= midpoint ? columnCenter + offset : columnCenter - offset;
  const edge = geometry.tooltipWidth / 2 + 6;
  return Math.min(Math.max(preferred, edge), Math.max(chartWidth - edge, edge));
}

function chartLabel(days: CampaignAnalyticsDay[], series: Array<{ label: string }>) {
  if (days.length === 0) return "Daily campaign outcomes, no days in range";
  const names = series.map((entry) => entry.label).join(", ");
  return `Daily campaign outcomes (${names}) from ${formatChartDate(days[0].date)} to ${formatChartDate(days[days.length - 1].date)}`;
}

function columnLabel(day: CampaignAnalyticsDay, series: Array<{ key: ChartSeriesKey; label: string }>) {
  const values = series.map((entry) => `${entry.label} ${day[entry.key]}`).join(", ");
  return `${formatChartDate(day.date)}: ${values}`;
}

export function formatAxisDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00.000Z`));
}

export function formatChartDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00.000Z`));
}
