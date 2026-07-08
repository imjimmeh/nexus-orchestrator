import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BudgetTimelineRow } from "@/lib/api/client.budget.types";
import { BUDGET_CHART_PALETTE } from "./budget-chart-colors";
import { formatDollars } from "./budget-format-utils";

interface SpendTimelineChartProps {
  timeline: BudgetTimelineRow[];
  isLoading: boolean;
}

export function SpendTimelineChart({
  timeline,
  isLoading,
}: Readonly<SpendTimelineChartProps>) {
  const data = useMemo(
    () =>
      timeline.map((r) => ({
        bucket: r.bucket,
        cents: Number(r.total_cents) / 100,
      })),
    [timeline],
  );

  if (isLoading) {
    return <div className="h-[200px] animate-pulse rounded bg-muted" />;
  }
  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
        No timeline data available
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
        <YAxis
          tick={{ fontSize: 12 }}
          tickFormatter={(value: number) => formatDollars(value)}
        />
        <Tooltip
          formatter={(value) =>
            typeof value === "number" ? formatDollars(value) : value
          }
        />
        <Area
          type="monotone"
          dataKey="cents"
          stroke={BUDGET_CHART_PALETTE[0]}
          fill={BUDGET_CHART_PALETTE[0]}
          fillOpacity={0.2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
