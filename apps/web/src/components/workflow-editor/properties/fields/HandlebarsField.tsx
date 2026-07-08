import { useId } from "react";
import { Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface HandlebarsFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  description?: string;
  error?: string;
  disabled?: boolean;
  showHelper?: boolean;
  id?: string;
}

function HandlebarsField({
  label,
  value,
  onChange,
  placeholder,
  description,
  error,
  disabled,
  showHelper,
  id,
}: HandlebarsFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  function handleInsertTemplate() {
    onChange("{{ }}");
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId}>{label}</Label>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      <div className="flex items-center gap-1.5">
        <Input
          id={fieldId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={cn("flex-1", error && "border-destructive")}
        />
        {showHelper && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={handleInsertTemplate}
            aria-label="Insert Handlebars template"
          >
            <Braces className="h-4 w-4" />
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export { HandlebarsField };
export type { HandlebarsFieldProps };
