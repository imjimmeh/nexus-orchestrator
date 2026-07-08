import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BudgetSpendTab } from "@/components/budget/BudgetSpendTab";
import { BudgetPoliciesTab } from "@/components/budget/BudgetPoliciesTab";

export function BudgetPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Budget</h2>
        <p className="text-muted-foreground">
          Spend analytics and cost governance policies
        </p>
      </div>

      <Tabs defaultValue="spend">
        <TabsList>
          <TabsTrigger value="spend">Spend</TabsTrigger>
          <TabsTrigger value="policies">Policies</TabsTrigger>
        </TabsList>
        <TabsContent value="spend">
          <BudgetSpendTab />
        </TabsContent>
        <TabsContent value="policies">
          <BudgetPoliciesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
