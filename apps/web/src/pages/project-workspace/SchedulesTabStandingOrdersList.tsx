import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StandingOrder } from "@/lib/api/projects.types";

interface StandingOrdersListProps {
  readonly orders: StandingOrder[];
  readonly isLoading: boolean;
  readonly updatePending: boolean;
  readonly deletePending: boolean;
  readonly onToggleEnabled: (order: StandingOrder) => void;
  readonly onDelete: (orderId: string) => void;
}

function StandingOrdersList({
  orders,
  isLoading,
  updatePending,
  deletePending,
  onToggleEnabled,
  onDelete,
}: Readonly<StandingOrdersListProps>) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Active Standing Orders</p>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">
          Loading standing orders...
        </p>
      ) : orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No standing orders configured for this project.
        </p>
      ) : (
        orders.map((order) => (
          <div key={order.id} className="rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant={order.enabled ? "default" : "outline"}>
                    {order.enabled ? "enabled" : "disabled"}
                  </Badge>
                  <p className="font-medium text-sm">{order.title}</p>
                  <Badge variant="outline">Priority {order.priority}</Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {order.instruction}
                </p>
                {order.profile_name && (
                  <p className="text-xs text-muted-foreground">
                    Profile: {order.profile_name}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onToggleEnabled(order)}
                  disabled={updatePending}
                >
                  {order.enabled ? "Disable" : "Enable"}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => onDelete(order.id)}
                  disabled={deletePending}
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export { StandingOrdersList };
