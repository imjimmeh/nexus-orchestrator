import { type ReactNode } from "react";
import { Handle, Position } from "@xyflow/react";
import { cn } from "@/lib/utils";

interface GraphNodeCardProps {
  icon: ReactNode;
  typeLabel: string;
  title: string;
  accentColor: string;
  secondaryText?: string;
  tier?: string;
  preview?: ReactNode;
  statusSlot?: ReactNode;
  actionSlot?: ReactNode;
  footer?: ReactNode;
  selected?: boolean;
  compact?: boolean;
  muted?: boolean;
}

interface GraphNodeHeaderProps {
  icon: ReactNode;
  typeLabel: string;
  statusSlot?: ReactNode;
  actionSlot?: ReactNode;
}

interface GraphNodeDetailsProps {
  title: string;
  secondaryText?: string;
  showSecondaryText: boolean;
  tier?: string;
  showTier: boolean;
}

interface GraphNodePreviewProps {
  preview: ReactNode;
  compact: boolean;
}

function normalizeText(value: string): string {
  return value.trim();
}

export function shouldShowSecondaryText(
  title: string,
  secondaryText: string | undefined,
): boolean {
  if (!secondaryText) {
    return false;
  }

  const normalizedSecondaryText = normalizeText(secondaryText);
  if (!normalizedSecondaryText) {
    return false;
  }

  return normalizeText(title) !== normalizedSecondaryText;
}

function getNodeSizeClasses(compact: boolean): string {
  return compact
    ? "min-w-[160px] max-w-[200px]"
    : "min-w-[210px] max-w-[280px]";
}

function getHandleSizeClasses(compact: boolean): string {
  return compact ? "!h-1.5 !w-1.5" : "!h-2 !w-2";
}

function GraphNodeHeader({
  icon,
  typeLabel,
  statusSlot,
  actionSlot,
}: Readonly<GraphNodeHeaderProps>) {
  const hasControls = Boolean(statusSlot || actionSlot);

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <p className="truncate text-xs uppercase tracking-wide text-muted-foreground">
          {typeLabel}
        </p>
      </div>
      {hasControls && (
        <div
          data-testid="graph-node-controls"
          className="flex shrink-0 items-center gap-2 nodrag nopan"
        >
          {statusSlot}
          {actionSlot}
        </div>
      )}
    </div>
  );
}

function GraphNodeDetails({
  title,
  secondaryText,
  showSecondaryText,
  tier,
  showTier,
}: Readonly<GraphNodeDetailsProps>) {
  return (
    <div className="space-y-0.5">
      <p className="truncate text-sm font-medium leading-tight">{title}</p>
      {showSecondaryText && (
        <p className="truncate text-xs text-muted-foreground">
          {secondaryText?.trim()}
        </p>
      )}
      {showTier && (
        <p className="truncate text-xs text-muted-foreground">
          Tier: {tier?.trim()}
        </p>
      )}
    </div>
  );
}

function GraphNodePreview({
  preview,
  compact,
}: Readonly<GraphNodePreviewProps>) {
  return (
    <div
      className={cn(
        "text-xs text-muted-foreground",
        compact ? "truncate" : "break-words whitespace-pre-wrap",
      )}
    >
      {preview}
    </div>
  );
}

export function GraphNodeCard({
  icon,
  typeLabel,
  title,
  accentColor,
  secondaryText,
  tier,
  preview,
  statusSlot,
  actionSlot,
  footer,
  selected = false,
  compact = false,
  muted = false,
}: Readonly<GraphNodeCardProps>) {
  const showSecondaryText = shouldShowSecondaryText(title, secondaryText);
  const showTier = typeof tier === "string" && tier.trim().length > 0;
  const nodeSizeClasses = getNodeSizeClasses(compact);
  const handleSizeClasses = getHandleSizeClasses(compact);

  return (
    <div
      className={cn(
        "relative rounded-md border bg-card text-card-foreground shadow-sm",
        nodeSizeClasses,
        selected && "ring-2 ring-primary",
        compact ? "px-2 py-1.5" : "px-3 py-2",
        muted && "bg-muted/50 border-muted-foreground/20",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className={handleSizeClasses}
      />
      <div
        data-testid="graph-node-accent"
        className={cn("absolute inset-x-0 top-0 h-1 rounded-t-md", accentColor)}
      />
      <div className="space-y-2 pt-1">
        <GraphNodeHeader
          icon={icon}
          typeLabel={typeLabel}
          statusSlot={statusSlot}
          actionSlot={actionSlot}
        />
        <GraphNodeDetails
          title={title}
          secondaryText={secondaryText}
          showSecondaryText={showSecondaryText}
          tier={tier}
          showTier={showTier}
        />
        {preview && <GraphNodePreview preview={preview} compact={compact} />}

        {footer && <div className="border-t pt-2">{footer}</div>}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className={handleSizeClasses}
      />
    </div>
  );
}
