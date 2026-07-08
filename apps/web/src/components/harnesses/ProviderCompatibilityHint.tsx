import { Badge } from "@/components/ui/badge";

interface ProviderCompatibilityHintProps {
  compatibleProviderIds: string[] | undefined;
  selectedProviderId: string | undefined;
}

function ProviderCompatibilityHint({
  compatibleProviderIds,
  selectedProviderId,
}: Readonly<ProviderCompatibilityHintProps>) {
  if (!compatibleProviderIds || compatibleProviderIds.length === 0) {
    return null;
  }

  const isIncompatible =
    !!selectedProviderId && !compatibleProviderIds.includes(selectedProviderId);

  return (
    <div className="space-y-1 text-sm">
      <p className="text-muted-foreground">
        Compatible providers: {compatibleProviderIds.join(", ")}
      </p>
      {isIncompatible && (
        <Badge variant="destructive">
          Incompatible provider selected ({selectedProviderId})
        </Badge>
      )}
    </div>
  );
}

export { ProviderCompatibilityHint };
export type { ProviderCompatibilityHintProps };
