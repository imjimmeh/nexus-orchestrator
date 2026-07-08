import { useState } from "react";
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
import { EffectiveConfigInspector } from "@/components/variables/EffectiveConfigInspector";
import {
  useDeleteVariable,
  useScopedVariables,
  useUpsertVariable,
} from "@/hooks/useScopedVariables";
import { useScopeContext } from "@/context/ScopeContext";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";
import type { VariablesEditorPageProps } from "./VariablesEditorPage.types";

const VALUE_TYPES = ["string", "number", "boolean", "json"] as const;
type ValueType = (typeof VALUE_TYPES)[number];

function coerce(value: string, type: ValueType): unknown {
  if (type === "number") return Number(value);
  if (type === "boolean") return value === "true";
  if (type === "json") return JSON.parse(value);
  return value;
}

export function VariablesEditorPage({
  scopeId: scopeIdProp,
}: VariablesEditorPageProps) {
  const { activeScopeNodeId } = useScopeContext();
  // When no explicit scope is passed in (the standalone /variables route),
  // scope the list to the app-wide active scope so switching scope refetches
  // this page's variables too. GLOBAL_SCOPE_NODE_ID maps to `null` (the
  // global tier), matching the backend's `!scopeId` branch in
  // VariablesController#list.
  const scopeId =
    scopeIdProp !== undefined
      ? scopeIdProp
      : activeScopeNodeId === GLOBAL_SCOPE_NODE_ID
        ? null
        : activeScopeNodeId;
  const { data: rows } = useScopedVariables(scopeId);
  const upsert = useUpsertVariable(scopeId);
  const remove = useDeleteVariable(scopeId);

  const [key, setKey] = useState("");
  const [rawValue, setRawValue] = useState("");
  const [valueType, setValueType] = useState<ValueType>("string");

  const handleSave = () => {
    if (!key) return;
    upsert.mutate({
      scopeNodeId: scopeId,
      key,
      value: coerce(rawValue, valueType),
      valueType,
    });
    setKey("");
    setRawValue("");
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Variables ({scopeId ? "project" : "global"})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="var-key">Key</Label>
              <Input
                id="var-key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="variable.key"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="var-value">Value</Label>
              <Input
                id="var-value"
                value={rawValue}
                onChange={(e) => setRawValue(e.target.value)}
                placeholder="value"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="var-type">Type</Label>
              <Select
                value={valueType}
                onValueChange={(v) => setValueType(v as ValueType)}
              >
                <SelectTrigger id="var-type" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VALUE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleSave} disabled={!key || upsert.isPending}>
              Save
            </Button>
          </div>

          <div className="space-y-2">
            {(rows ?? []).map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between rounded border p-2"
              >
                <span className="font-mono text-sm">
                  {row.key} = {JSON.stringify(row.value)} ({row.value_type})
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => remove.mutate(row.key)}
                  disabled={remove.isPending}
                >
                  Delete
                </Button>
              </div>
            ))}
            {(rows ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                No variables defined.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <EffectiveConfigInspector scopeId={scopeId} />
    </>
  );
}
