import { useState, useMemo } from "react";
import { useBudgetSummary } from "@/hooks/useBudgetSummary";
import { useBudgetTimeline } from "@/hooks/useBudgetTimeline";
import { KpiCard } from "./KpiCard";
import type { BudgetSummaryParams } from "@/lib/api/client.budget.types";
import type { DateRange } from "./DateRangePicker";
import { SpendTimelineChart } from "./budget-spend-timeline-chart";
import { SpendPieChart } from "./budget-spend-pie-chart";
import { TopSpendersChart } from "./budget-top-spenders-chart";
import { SummaryTable } from "./budget-summary-table";
import { formatCentsToDollars, formatTokens } from "./budget-format-utils";

type GroupBy = NonNullable<BudgetSummaryParams["group_by"]>;

type BudgetOverviewTabProps = {
  dateRange: DateRange;
};

export function BudgetOverviewTab({ dateRange }: BudgetOverviewTabProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>("provider");

  const { data: rows = [], isLoading } = useBudgetSummary({
    group_by: groupBy,
    from: dateRange.from,
    to: dateRange.to,
  });

  const { data: timeline = [], isLoading: timelineLoading } = useBudgetTimeline(
    {
      from: dateRange.from,
      to: dateRange.to,
    },
  );

  const kpi = useMemo(() => {
    if (rows.length === 0) {
      return { totalCents: 0, totalTokens: 0, totalCount: 0, avgCost: 0 };
    }
    const totalCents = rows.reduce((sum, r) => sum + Number(r.total_cents), 0);
    const totalTokens = rows.reduce(
      (sum, r) => sum + Number(r.total_tokens),
      0,
    );
    const totalCount = rows.reduce((sum, r) => sum + Number(r.count), 0);
    return {
      totalCents,
      totalTokens,
      totalCount,
      avgCost: totalCount > 0 ? totalCents / totalCount : 0,
    };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total Spend"
          value={formatCentsToDollars(kpi.totalCents)}
          isLoading={isLoading}
        />
        <KpiCard
          title="Total Tokens"
          value={formatTokens(kpi.totalTokens)}
          isLoading={isLoading}
        />
        <KpiCard
          title="Event Count"
          value={kpi.totalCount.toLocaleString()}
          isLoading={isLoading}
        />
        <KpiCard
          title="Avg Cost/Event"
          value={formatCentsToDollars(kpi.avgCost)}
          isLoading={isLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-6">
          <h3 className="mb-4 text-sm font-medium">Spend Over Time</h3>
          <SpendTimelineChart timeline={timeline} isLoading={timelineLoading} />
        </div>
        <div className="rounded-xl border bg-card p-6">
          <h3 className="mb-4 text-sm font-medium">Spend by {groupBy}</h3>
          <SpendPieChart rows={rows} isLoading={isLoading} />
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <h3 className="mb-4 text-sm font-medium">Top 10 Spenders</h3>
        <TopSpendersChart rows={rows} isLoading={isLoading} />
      </div>

      <SummaryTable
        rows={rows}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        isLoading={isLoading}
      />
    </div>
  );
}
