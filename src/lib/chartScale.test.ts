import { describe, expect, it } from "vitest";
import { niceScale, showAxisLabel, tickLabelInterval } from "./chartScale";

describe("niceScale", () => {
  it("keeps a readable integer axis when nothing happened", () => {
    expect(niceScale(0)).toEqual({ domainMax: 4, ticks: [0, 1, 2, 3, 4] });
  });

  it("uses whole-number ticks for small counts", () => {
    expect(niceScale(3)).toEqual({ domainMax: 3, ticks: [0, 1, 2, 3] });
    expect(niceScale(1)).toEqual({ domainMax: 1, ticks: [0, 1] });
  });

  it("rounds larger peaks up to a clean maximum", () => {
    expect(niceScale(7)).toEqual({ domainMax: 8, ticks: [0, 2, 4, 6, 8] });
    expect(niceScale(23)).toEqual({ domainMax: 30, ticks: [0, 10, 20, 30] });
    expect(niceScale(140)).toEqual({ domainMax: 150, ticks: [0, 50, 100, 150] });
  });

  it("never returns a tick above the domain maximum", () => {
    for (const peak of [1, 2, 5, 9, 13, 47, 99, 250]) {
      const { domainMax, ticks } = niceScale(peak);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBe(domainMax);
      expect(domainMax).toBeGreaterThanOrEqual(peak);
    }
  });
});

describe("tickLabelInterval", () => {
  it("labels every slot when there is room", () => {
    expect(tickLabelInterval(60, 7)).toBe(1);
  });

  it("thins labels on narrow slots", () => {
    expect(tickLabelInterval(22, 30)).toBe(3);
  });

  it("never exceeds the number of slots", () => {
    expect(tickLabelInterval(4, 2)).toBe(2);
  });
});

describe("showAxisLabel", () => {
  it("always labels the most recent day", () => {
    expect(showAxisLabel(29, 30, 3)).toBe(true);
  });

  it("spaces earlier labels by the interval", () => {
    const labelled = Array.from({ length: 30 }, (_, index) => showAxisLabel(index, 30, 3))
      .map((visible, index) => (visible ? index : null))
      .filter((index): index is number => index !== null);
    expect(labelled).toEqual([2, 5, 8, 11, 14, 17, 20, 23, 26, 29]);
  });
});
