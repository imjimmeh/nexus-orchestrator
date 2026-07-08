import { Badge } from "@/components/ui/badge";

type ProviderModelBadgeProps = {
  provider?: string | null;
  model?: string | null;
  harnessId?: string | null;
  providerSource?: string | null;
};

export function ProviderModelBadge({
  provider,
  model,
  harnessId,
  providerSource,
}: Readonly<ProviderModelBadgeProps>) {
  const label =
    model || provider
      ? `${provider ?? "?"} · ${model ?? "?"}`
      : "unknown model";

  const titleParts = [
    harnessId ? `harness: ${harnessId}` : null,
    providerSource ? `source: ${providerSource}` : null,
  ].filter(Boolean);

  return (
    <Badge
      variant="outline"
      className="font-mono text-xs"
      title={titleParts.join(" · ") || undefined}
    >
      {label}
    </Badge>
  );
}
