import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BudgetSummaryRow } from "@/lib/api/client.budget.types";
import { getCategoryColor } from "./budget-chart-colors";
import { formatDollars } from "./budget-format-utils";

interface TopSpendersChartProps {
  rows: BudgetSummaryRow[];
  isLoading: boolean;
}

export function TopSpendersChart({
  rows,
  isLoading,
}: Readonly<TopSpendersChartProps>) {
  const data = useMemo(() => {
    return [...rows]
      .sort((a, b) => Number(b.total_cents) - Number(a.total_cents))
      .slice(0, 10)
      .map((r, i) => ({
        name: r.key.length > 20 ? r.key.slice(0, 20) + "..." : r.key,
        dollars: Number(r.total_cents) / 100,
        fill: getCategoryColor(r.key, i),
      }));
  }, [rows]);

  if (isLoading) {
    return <div className="h-[200px] animate-pulse rounded bg-muted" />;
  }
  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
        No data available
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
        <YAxis
          tick={{ fontSize: 12 }}
          tickFormatter={(value) => formatDollars(Number(value))}
        />
        <Tooltip formatter={(value) => formatDollars(Number(value))} />
        <Bar dataKey="dollars" />
      </BarChart>
    </ResponsiveContainer>
  );
}
