import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useStandingOrders,
  useCreateStandingOrder,
  useDeleteStandingOrder,
  useUpdateStandingOrder,
} from "@/hooks/useAutomationControls";
import { useToast } from "@/hooks/useToast";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { StandingOrder } from "@/lib/api/projects.types";
import { StandingOrdersList } from "./SchedulesTabStandingOrdersList";

interface SchedulesTabStandingOrdersCardProps {
  readonly projectId: string;
}

interface StandingOrderFormState {
  title: string;
  instruction: string;
  priorityText: string;
  enabled: boolean;
}

const INITIAL_FORM_STATE: StandingOrderFormState = {
  title: "",
  instruction: "",
  priorityText: "100",
  enabled: true,
};

export function SchedulesTabStandingOrdersCard({
  projectId,
}: Readonly<SchedulesTabStandingOrdersCardProps>) {
  const toast = useToast();
  const ordersQuery = useStandingOrders(projectId);
  const createOrder = useCreateStandingOrder(projectId);
  const updateOrder = useUpdateStandingOrder(projectId);
  const deleteOrder = useDeleteStandingOrder(projectId);

  const [form, setForm] = useState<StandingOrderFormState>(INITIAL_FORM_STATE);

  const handleCreate = async () => {
    if (!form.title.trim() || !form.instruction.trim()) {
      toast.error("Missing fields", "Title and instruction are required.");
      return;
    }

    const priority = Number.parseInt(form.priorityText, 10);
    if (!Number.isFinite(priority) || priority < 0) {
      toast.error(
        "Invalid priority",
        "Priority must be a non-negative integer.",
      );
      return;
    }

    try {
      await createOrder.mutateAsync({
        title: form.title.trim(),
        instruction: form.instruction.trim(),
        priority,
        enabled: form.enabled,
      });
      toast.success("Standing order created", "Policy instruction added.");
      setForm(INITIAL_FORM_STATE);
    } catch (error) {
      toast.error(
        "Failed to create standing order",
        getApiErrorMessage(error, "Unable to save policy."),
      );
    }
  };

  const toggleEnabled = async (order: StandingOrder) => {
    try {
      await updateOrder.mutateAsync({
        id: order.id,
        data: { enabled: !order.enabled },
      });
      toast.info(
        order.enabled ? "Order disabled" : "Order enabled",
        order.enabled
          ? "This policy is now inactive."
          : "This policy is now active for agents.",
      );
    } catch (error) {
      toast.error(
        "Failed to update standing order",
        getApiErrorMessage(error, "Unable to update policy state."),
      );
    }
  };

  const removeOrder = async (orderId: string) => {
    try {
      await deleteOrder.mutateAsync(orderId);
      toast.info("Order deleted", "Standing order removed.");
    } catch (error) {
      toast.error(
        "Failed to delete standing order",
        getApiErrorMessage(error, "Unable to delete policy."),
      );
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Standing Orders</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="order-title">Policy Title</Label>
            <Input
              id="order-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Code Review Standards"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="order-instruction">Instruction</Label>
            <Textarea
              id="order-instruction"
              value={form.instruction}
              onChange={(e) =>
                setForm({ ...form, instruction: e.target.value })
              }
              placeholder="Describe the persistent rule or preference for agents..."
              className="min-h-[100px]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="order-priority">Priority</Label>
            <Input
              id="order-priority"
              type="number"
              value={form.priorityText}
              onChange={(e) =>
                setForm({ ...form, priorityText: e.target.value })
              }
            />
          </div>

          <div className="flex items-center gap-2 pt-8">
            <input
              id="order-enabled"
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            <Label htmlFor="order-enabled">Enable immediately</Label>
          </div>
        </div>

        <Button
          onClick={() => {
            void handleCreate();
          }}
          disabled={createOrder.isPending}
        >
          {createOrder.isPending ? "Saving..." : "Add Standing Order"}
        </Button>

        <StandingOrdersList
          orders={ordersQuery.data?.items ?? []}
          isLoading={ordersQuery.isLoading}
          updatePending={updateOrder.isPending}
          deletePending={deleteOrder.isPending}
          onToggleEnabled={(order) => {
            void toggleEnabled(order);
          }}
          onDelete={(id) => {
            void removeOrder(id);
          }}
        />
      </CardContent>
    </Card>
  );
}
