export type NiceScale = {
  domainMax: number;
  ticks: number[];
};

const STEP_MULTIPLIERS = [1, 2, 5, 10];

/**
 * Round a count axis up to a readable maximum and return whole-number ticks.
 * Counts are integers, so every tick is an integer and the axis never shows
 * values like 0.5 for a day with a single action.
 */
export function niceScale(maxValue: number, targetTicks = 4): NiceScale {
  const safeMax = Number.isFinite(maxValue) && maxValue > 0 ? Math.ceil(maxValue) : 0;
  if (safeMax === 0) return { domainMax: 4, ticks: [0, 1, 2, 3, 4] };

  const step = niceStep(safeMax / Math.max(targetTicks, 1));
  const domainMax = step * Math.ceil(safeMax / step);
  const ticks: number[] = [];
  for (let value = 0; value <= domainMax + 1e-9; value += step) ticks.push(Math.round(value));
  return { domainMax, ticks };
}

function niceStep(rawStep: number) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rawStep, 1)));
  for (const multiplier of STEP_MULTIPLIERS) {
    const candidate = multiplier * magnitude;
    if (candidate >= rawStep) return Math.max(1, candidate);
  }
  return Math.max(1, 10 * magnitude);
}

/**
 * How many slots to skip between axis labels so neighbouring dates never collide.
 */
export function tickLabelInterval(slotWidth: number, totalSlots: number, minLabelWidth = 58) {
  const needed = Math.ceil(minLabelWidth / Math.max(slotWidth, 1));
  return Math.min(Math.max(needed, 1), Math.max(totalSlots, 1));
}

/** Labels are anchored to the newest day, so the latest date is always readable. */
export function showAxisLabel(index: number, total: number, interval: number) {
  if (total <= 0) return false;
  return (total - 1 - index) % interval === 0;
}
