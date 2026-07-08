import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHarnesses } from "@/hooks/useHarnesses";
import { useModels } from "@/hooks/useModels";
import { useProviders } from "@/hooks/useProviders";
import {
  useScopedAiDefault,
  useSetScopedAiDefault,
} from "@/hooks/useScopedAiDefaults";

const INHERIT_OPTION_VALUE = "__inherit__";

interface ScopedDefaultsFormProps {
  scopeNodeId: string;
}

function ScopedDefaultsForm({
  scopeNodeId,
}: Readonly<ScopedDefaultsFormProps>) {
  const { data: current } = useScopedAiDefault(scopeNodeId);
  const { data: harnesses = [] } = useHarnesses();
  const { data: models = [] } = useModels();
  const { data: providers = [] } = useProviders();
  const setDefault = useSetScopedAiDefault();

  const [harnessId, setHarnessId] = useState<string | undefined>(undefined);
  const [modelName, setModelName] = useState<string | undefined>(undefined);
  const [providerName, setProviderName] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    setHarnessId(current?.harnessId ?? undefined);
    setModelName(current?.modelName ?? undefined);
    setProviderName(current?.providerName ?? undefined);
  }, [current?.harnessId, current?.modelName, current?.providerName]);

  async function handleSave() {
    await setDefault.mutateAsync({
      scopeNodeId,
      body: { harnessId, modelName, providerName },
    });
  }

  function handleSelectChange(
    setter: (value: string | undefined) => void,
    value: string,
  ) {
    setter(value === INHERIT_OPTION_VALUE ? undefined : value);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Harness</Label>
        <Select
          value={harnessId ?? INHERIT_OPTION_VALUE}
          onValueChange={(value) => handleSelectChange(setHarnessId, value)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT_OPTION_VALUE}>
              Inherit default
            </SelectItem>
            {harnesses.map((harness) => (
              <SelectItem key={harness.harnessId} value={harness.harnessId}>
                {harness.displayName ?? harness.harnessId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Model</Label>
        <Select
          value={modelName ?? INHERIT_OPTION_VALUE}
          onValueChange={(value) => handleSelectChange(setModelName, value)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT_OPTION_VALUE}>
              Inherit default
            </SelectItem>
            {models.map((model) => (
              <SelectItem key={model.id} value={model.name}>
                {model.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Provider</Label>
        <Select
          value={providerName ?? INHERIT_OPTION_VALUE}
          onValueChange={(value) => handleSelectChange(setProviderName, value)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT_OPTION_VALUE}>
              Inherit default
            </SelectItem>
            {providers.map((provider) => (
              <SelectItem key={provider.id} value={provider.name}>
                {provider.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button onClick={handleSave} disabled={setDefault.isPending}>
        {setDefault.isPending ? "Saving..." : "Save defaults"}
      </Button>
    </div>
  );
}

export { ScopedDefaultsForm };
export type { ScopedDefaultsFormProps };
