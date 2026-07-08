import { useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateRangePicker } from "@/components/budget/DateRangePicker";
import { BudgetOverviewTab } from "@/components/budget/BudgetOverviewTab";
import { BudgetEventsTab } from "@/components/budget/BudgetEventsTab";
import { BudgetWorkItemsTab } from "@/components/budget/BudgetWorkItemsTab";
import type { DateRange } from "@/components/budget/DateRangePicker";

export function BudgetSpendTab() {
  const [dateRange, setDateRange] = useState<DateRange>({});

  const handleDateRangeChange = useCallback((range: DateRange) => {
    setDateRange(range);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <DateRangePicker value={dateRange} onChange={handleDateRangeChange} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="events">Usage Events</TabsTrigger>
          <TabsTrigger value="work-items">By Work Item</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <BudgetOverviewTab dateRange={dateRange} />
        </TabsContent>
        <TabsContent value="events">
          <BudgetEventsTab dateRange={dateRange} />
        </TabsContent>
        <TabsContent value="work-items">
          <BudgetWorkItemsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
