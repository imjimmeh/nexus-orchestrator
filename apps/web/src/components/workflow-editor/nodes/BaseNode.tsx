import { type ReactNode } from "react";
import { Handle, Position } from "@xyflow/react";
import { cn } from "@/lib/utils";

interface BaseNodeProps {
  icon: ReactNode;
  label: string;
  accentColor: string;
  children?: ReactNode;
  footer?: ReactNode;
  selected?: boolean;
}

export function BaseNode({
  icon,
  label,
  accentColor,
  children,
  footer,
  selected,
}: BaseNodeProps) {
  return (
    <div
      className={cn(
        "min-w-[210px] max-w-[260px] rounded-md border shadow-sm bg-card",
        selected && "ring-2 ring-primary",
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2" />
      <div className={cn("h-1.5 rounded-t-md", accentColor)} />
      <div className="px-3 py-2 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <span className="text-sm font-medium truncate">{label}</span>
        </div>
        {children}
      </div>
      {footer && <div className="border-t px-3 py-1.5">{footer}</div>}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2" />
    </div>
  );
}
