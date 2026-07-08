export function formatCentsToDollars(cents: string | number): string {
  const num = typeof cents === "string" ? Number(cents) : cents;
  return `$${(num / 100).toFixed(2)}`;
}

export function formatDollars(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}

export function formatTokens(tokens: string | number): string {
  const num = typeof tokens === "string" ? Number(tokens) : tokens;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}
