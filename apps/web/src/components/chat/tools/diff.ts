import type { DiffLine } from "./diff.types";

export type { DiffLine };

function splitLines(s: string): string[] {
  if (s === "") return [];
  return s.split("\n");
}

export function computeUnifiedDiff(oldS: string, newS: string): DiffLine[] {
  const a = splitLines(oldS);
  const b = splitLines(newS);
  const m = a.length,
    n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0,
    j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: "context", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < m) {
    out.push({ type: "del", text: a[i] });
    i++;
  }
  while (j < n) {
    out.push({ type: "add", text: b[j] });
    j++;
  }
  return out;
}

export function countDiff(lines: DiffLine[]): {
  added: number;
  removed: number;
} {
  let added = 0,
    removed = 0;
  for (const l of lines) {
    if (l.type === "add") added++;
    else if (l.type === "del") removed++;
  }
  return { added, removed };
}
