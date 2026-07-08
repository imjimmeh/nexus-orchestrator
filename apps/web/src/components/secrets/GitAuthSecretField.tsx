import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SecretOption } from "./secret-option.types";

const NO_SECRET_VALUE = "__none__";

export interface GitAuthSecretFieldProps {
  id?: string;
  value: string | null;
  secrets: ReadonlyArray<SecretOption>;
  secretsError: boolean;
  onChange: (value: string | null) => void;
  onManageSecrets?: () => void;
  label?: string;
  helpText?: string;
  noneLabel?: string;
}

export function GitAuthSecretField({
  id,
  value,
  secrets,
  secretsError,
  onChange,
  onManageSecrets,
  label = "Git Auth Secret",
  helpText,
  noneLabel = "No secret selected",
}: Readonly<GitAuthSecretFieldProps>) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const helpId = `${fieldId}-help`;
  const errorId = `${fieldId}-error`;
  const describedBy =
    [helpText ? helpId : null, secretsError ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={fieldId}>{label}</Label>
        {onManageSecrets && (
          <Button
            variant="outline"
            size="sm"
            onClick={onManageSecrets}
            type="button"
          >
            Manage Secrets
          </Button>
        )}
      </div>
      <Select
        value={value ?? NO_SECRET_VALUE}
        onValueChange={(next) =>
          onChange(next === NO_SECRET_VALUE ? null : next)
        }
      >
        <SelectTrigger
          id={fieldId}
          aria-invalid={secretsError || undefined}
          aria-describedby={describedBy}
        >
          <SelectValue placeholder="Select secret" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_SECRET_VALUE}>{noneLabel}</SelectItem>
          {secrets.map((secret) => (
            <SelectItem key={secret.id} value={secret.id}>
              {secret.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {helpText && (
        <p id={helpId} className="text-xs text-muted-foreground">
          {helpText}
        </p>
      )}
      {secretsError && (
        <p id={errorId} className="text-xs text-destructive">
          Failed to load secrets. Existing secret linkage will still be
          preserved unless you change it.
        </p>
      )}
    </div>
  );
}
