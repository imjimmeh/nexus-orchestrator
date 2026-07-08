import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ProjectOrchestration } from "@/lib/api/projects.types";

interface OrchestrationImportHydrationBannerProps {
  orchestration: ProjectOrchestration;
}

export function OrchestrationImportHydrationBanner({
  orchestration,
}: Readonly<OrchestrationImportHydrationBannerProps>) {
  const banner = resolveImportHydrationBanner(orchestration);
  if (!banner) {
    return null;
  }

  return (
    <Alert>
      <AlertTitle>{banner.title}</AlertTitle>
      <AlertDescription>{banner.message}</AlertDescription>
    </Alert>
  );
}

type ImportHydrationBanner = {
  title: string;
  message: string;
};

function resolveImportHydrationBanner(
  orchestration: ProjectOrchestration,
): ImportHydrationBanner | null {
  const metadata = toRecord(orchestration.metadata);
  const importContext = toRecord(metadata?.importContext);
  if (!importContext) {
    return null;
  }

  const hydration = toRecord(importContext.hydration);
  if (!hydration) {
    return {
      title: "Repository being analysed",
      message:
        "Imported repository evidence is still being synthesized into canonical work items.",
    };
  }

  const implementedCount = readNonNegativeNumber(hydration.implementedCount);
  const backlogCount = readNonNegativeNumber(hydration.backlogCount);
  if (implementedCount === null || backlogCount === null) {
    return {
      title: "Repository being analysed",
      message:
        "Imported repository evidence is still being synthesized into canonical work items.",
    };
  }

  return {
    title: "Repository analysis complete",
    message: `Found ${implementedCount} implemented capabilities, ${backlogCount} backlog items.`,
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.floor(value);
}
