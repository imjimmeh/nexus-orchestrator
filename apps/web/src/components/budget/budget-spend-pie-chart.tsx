import { useMemo } from "react";
import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { BudgetSummaryRow } from "@/lib/api/client.budget.types";
import { getCategoryColor } from "./budget-chart-colors";
import { formatCentsToDollars } from "./budget-format-utils";

interface SpendPieChartProps {
  rows: BudgetSummaryRow[];
  isLoading: boolean;
}

export function SpendPieChart({
  rows,
  isLoading,
}: Readonly<SpendPieChartProps>) {
  const data = useMemo(() => {
    const top10 = [...rows]
      .sort((a, b) => Number(b.total_cents) - Number(a.total_cents))
      .slice(0, 10);
    return top10.map((r, i) => ({
      name: r.key,
      value: Number(r.total_cents) / 100,
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
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={80}
          label={({ name }: { name?: string }) =>
            name ? (name.length > 12 ? name.slice(0, 12) + "..." : name) : ""
          }
        />
        <Tooltip
          formatter={(value) => formatCentsToDollars(Number(value) * 100)}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
