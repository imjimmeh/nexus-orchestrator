import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  useApplyOrchestrationPreset,
  useOrchestrationPolicy,
  useUpdateOrchestrationPolicy,
} from "@/hooks/useOrchestrationPolicy";
import type { ResolvedPolicyEntryDto } from "@/lib/api/client.orchestration-policy";

type DraftValue = string | number | boolean;

function PolicyControl(props: {
  entry: ResolvedPolicyEntryDto;
  value: DraftValue;
  onChange: (value: DraftValue) => void;
}) {
  const { entry, value, onChange } = props;
  const { descriptor } = entry;

  if (descriptor.valueType === "boolean") {
    return (
      <Switch
        aria-label={descriptor.label}
        checked={value as boolean}
        onCheckedChange={(checked) => onChange(checked)}
      />
    );
  }
  if (descriptor.valueType === "number") {
    return (
      <Input
        type="number"
        aria-label={descriptor.label}
        value={String(value)}
        min={descriptor.min}
        max={descriptor.max}
        step={descriptor.step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    );
  }
  if (descriptor.enumValues) {
    return (
      <Select value={String(value)} onValueChange={(v) => onChange(v)}>
        <SelectTrigger aria-label={descriptor.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {descriptor.enumValues.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input
      aria-label={descriptor.label}
      value={String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function OrchestrationPolicyPanel({
  projectId,
}: Readonly<{ projectId: string }>) {
  const { data, isLoading } = useOrchestrationPolicy(projectId);
  const update = useUpdateOrchestrationPolicy(projectId);
  const preset = useApplyOrchestrationPreset(projectId);
  const [draft, setDraft] = useState<Record<string, DraftValue>>({});

  useEffect(() => {
    if (data) {
      setDraft(Object.fromEntries(data.map((e) => [e.key, e.value])));
    }
  }, [data]);

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent>Loading policy…</CardContent>
      </Card>
    );
  }

  const changed = data
    .filter((e) => draft[e.key] !== e.value)
    .map((e) => ({ key: e.key, value: draft[e.key] }));

  const groups = Array.from(new Set(data.map((e) => e.descriptor.group)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Orchestration Policy</span>
          <Select
            onValueChange={(mode) =>
              preset.mutate(
                mode as "autonomous" | "supervised" | "notifications_only",
              )
            }
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Apply preset…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="autonomous">autonomous</SelectItem>
              <SelectItem value="supervised">supervised</SelectItem>
              <SelectItem value="notifications_only">
                notifications_only
              </SelectItem>
            </SelectContent>
          </Select>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {groups.map((group) => (
          <div key={group} className="space-y-3">
            <h4 className="text-sm font-semibold capitalize">{group}</h4>
            {data
              .filter((e) => e.descriptor.group === group)
              .map((entry) => (
                <div
                  key={entry.key}
                  className="flex items-center justify-between gap-4"
                >
                  <div className="space-y-0.5">
                    <Label>{entry.descriptor.label}</Label>
                    <p className="text-xs text-muted-foreground">
                      {entry.descriptor.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {entry.layer === "default" ? "default" : "project"}
                    </Badge>
                    <PolicyControl
                      entry={entry}
                      value={draft[entry.key] ?? entry.value}
                      onChange={(value) =>
                        setDraft((prev) => ({ ...prev, [entry.key]: value }))
                      }
                    />
                  </div>
                </div>
              ))}
          </div>
        ))}
        <Button
          disabled={changed.length === 0 || update.isPending}
          onClick={() => update.mutate(changed)}
        >
          Save
        </Button>
      </CardContent>
    </Card>
  );
}
