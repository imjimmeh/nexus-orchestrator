import { Button } from "@/components/ui/button";

export interface AgentChatHeaderSecondaryAction {
  label: string;
  onClick: () => void;
  pending?: boolean;
  disabled?: boolean;
}

export interface AgentChatHeaderFooterAction {
  label: string;
  onClick: () => void;
  pending?: boolean;
  disabled?: boolean;
  variant?: "default" | "outline" | "secondary" | "destructive" | "ghost";
}

export interface AgentChatHeaderProps {
  title: string;
  disabled: boolean;
  secondaryAction?: AgentChatHeaderSecondaryAction;
  footerAction?: AgentChatHeaderFooterAction;
}

function HeaderActions({
  disabled,
  secondaryAction,
  footerAction,
}: Readonly<{
  disabled: boolean;
  secondaryAction?: AgentChatHeaderSecondaryAction;
  footerAction?: AgentChatHeaderFooterAction;
}>) {
  const showActions = secondaryAction || footerAction;
  if (!showActions) {
    return null;
  }

  return (
    <div className="flex gap-2">
      {secondaryAction && (
        <Button
          variant="outline"
          size="sm"
          onClick={secondaryAction.onClick}
          disabled={
            disabled || secondaryAction.pending || secondaryAction.disabled
          }
        >
          {secondaryAction.pending ? "Working..." : secondaryAction.label}
        </Button>
      )}
      {footerAction && (
        <Button
          variant={footerAction.variant ?? "outline"}
          size="sm"
          onClick={footerAction.onClick}
          disabled={disabled || footerAction.pending || footerAction.disabled}
        >
          {footerAction.pending ? "Working..." : footerAction.label}
        </Button>
      )}
    </div>
  );
}

export function AgentChatHeader({
  title,
  disabled,
  secondaryAction,
  footerAction,
}: Readonly<AgentChatHeaderProps>) {
  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <HeaderActions
        disabled={disabled}
        secondaryAction={secondaryAction}
        footerAction={footerAction}
      />
    </div>
  );
}