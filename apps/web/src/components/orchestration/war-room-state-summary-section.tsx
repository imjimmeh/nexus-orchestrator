import type { WarRoomStateSummary } from "./WarRoomSessionManagerPanel.hooks";

interface WarRoomStateSummaryProps {
  isLoading: boolean;
  errorMessage: string | null;
  state: WarRoomStateSummary | undefined;
}

export function WarRoomStateSummaryPanel({
  isLoading,
  errorMessage,
  state,
}: Readonly<WarRoomStateSummaryProps>) {
  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Loading session state...</p>
    );
  }

  if (errorMessage) {
    return <p className="text-sm text-destructive">{errorMessage}</p>;
  }

  if (state?.status === "found") {
    return (
      <p className="text-xs text-muted-foreground">
        Participants: {state.participants?.length ?? 0} · Messages:{" "}
        {state.messages?.length ?? 0}
      </p>
    );
  }

  return (
    <p className="text-sm text-muted-foreground">
      {state?.denial_reason ?? "Session state unavailable."}
    </p>
  );
}
