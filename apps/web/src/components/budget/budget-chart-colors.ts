export const BUDGET_CHART_PALETTE = [
  "hsl(217 91% 60%)", // blue
  "hsl(160 84% 39%)", // emerald
  "hsl(38 92% 50%)", // amber
  "hsl(340 75% 55%)", // rose
  "hsl(263 70% 60%)", // violet
  "hsl(189 94% 43%)", // cyan
  "hsl(25 95% 53%)", // orange
  "hsl(239 84% 67%)", // indigo
];

const GOLDEN_ANGLE = 137.508;

export function getCategoryColor(key: string, index: number): string {
  if (index < BUDGET_CHART_PALETTE.length) {
    return BUDGET_CHART_PALETTE[index];
  }

  const hash = Array.from(key).reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  );
  const hue = Math.round((hash * GOLDEN_ANGLE) % 360);
  return `hsl(${hue} 70% 55%)`;
}
