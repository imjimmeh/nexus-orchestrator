import { useState } from "react";
import type { RuntimeToolchainConfig } from "@nexus/core";
import { RuntimeToolchainEditor } from "@/components/runtime-toolchains/RuntimeToolchainEditor";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface RuntimeToolchainsCardProps {
  value: RuntimeToolchainConfig;
  onSave: (next: RuntimeToolchainConfig) => void;
}

export function RuntimeToolchainsCard({
  value,
  onSave,
}: Readonly<RuntimeToolchainsCardProps>) {
  const [draft, setDraft] = useState<RuntimeToolchainConfig>(value);

  return (
    <div className="space-y-4 border-t pt-4">
      <div>
        <Label>Runtime Toolchains</Label>
        <p className="text-xs text-muted-foreground">
          Language/tool versions and cache mounts applied to workflow execution
          containers for this project.
        </p>
      </div>
      <RuntimeToolchainEditor value={draft} onChange={setDraft} />
      <Button type="button" variant="outline" onClick={() => onSave(draft)}>
        Save runtime toolchains
      </Button>
    </div>
  );
}
