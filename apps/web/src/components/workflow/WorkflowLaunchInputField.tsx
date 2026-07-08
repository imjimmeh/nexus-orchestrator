import { WorkflowLaunchInputContract } from "@/lib/api/workflow-launch.types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SelectItem } from "@/components/ui/select";
import { NullableSelect } from "@/components/ui/nullable-select";

export function WorkflowLaunchInputField(
  props: Readonly<{
    input: WorkflowLaunchInputContract;
    value: string;
    onChange: (value: string) => void;
  }>,
) {
  const { input, value, onChange } = props;
  const inputId = `workflow-launch-${input.key}`;

  if (input.type === "boolean") {
    return (
      <NullableSelect
        value={value || null}
        onValueChange={(v) => onChange(v ?? "")}
        placeholder="No value"
        className={inputId}
      >
        <SelectItem value="true">true</SelectItem>
        <SelectItem value="false">false</SelectItem>
      </NullableSelect>
    );
  }

  if (input.type === "json" || input.type === "string_array") {
    return (
      <Textarea
        id={inputId}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="min-h-[110px] font-mono text-xs"
      />
    );
  }

  return (
    <Input
      id={inputId}
      type={input.type === "number" ? "number" : "text"}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  );
}
