import { useState } from "react";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FallbackChainEditor } from "@/components/fallback/FallbackChainEditor";
import { useProviders } from "@/hooks/useProviders";
import { useModels } from "@/hooks/useModels";
import {
  useGlobalFallbackChain,
  useSetGlobalFallbackChain,
} from "@/hooks/useFallbackChains";
import { useToast } from "@/hooks/useToast";
import type { FallbackChainEntry } from "@nexus/core";

export function FallbackSettingsCard() {
  const { data: chain, isLoading } = useGlobalFallbackChain();
  const setChain = useSetGlobalFallbackChain();
  const { data: providers = [] } = useProviders();
  const { data: models = [] } = useModels();
  const toast = useToast();

  const [localEntries, setLocalEntries] = useState<
    FallbackChainEntry[] | undefined
  >(undefined);

  const entries: FallbackChainEntry[] = localEntries ?? chain?.entries ?? [];

  const handleSave = async () => {
    try {
      await setChain.mutateAsync(entries);
      setLocalEntries(undefined);
      toast.success("Saved", "Global fallback chain updated.");
    } catch {
      toast.error("Save failed", "Could not update the global fallback chain.");
    }
  };

  const isDirty = localEntries !== undefined;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Global Fallback Chain
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="h-5 w-5" />
          Global Fallback Chain
        </CardTitle>
        <CardDescription>
          Ordered list of provider/model pairs tried when the primary provider
          fails. Applies to all agents unless overridden per-profile.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FallbackChainEditor
          value={entries}
          onChange={(next) => setLocalEntries(next)}
          providers={providers}
          models={models}
        />
        <div className="flex justify-end">
          <Button
            onClick={() => void handleSave()}
            disabled={!isDirty || setChain.isPending}
          >
            {setChain.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
