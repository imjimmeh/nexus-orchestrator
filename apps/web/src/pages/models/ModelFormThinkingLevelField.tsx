import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INHERIT_THINKING_LEVEL } from "@/lib/thinking-level";
import { orderSupportedThinkingLevels } from "./ModelForm.hooks";
import type { ModelFormControls } from "./ModelForm.hooks.types";

interface ModelFormThinkingLevelFieldProps {
  control: ModelFormControls;
  supportedLevels: string[];
}

export function ModelFormThinkingLevelField({
  control,
  supportedLevels,
}: Readonly<ModelFormThinkingLevelFieldProps>) {
  const orderedLevels = orderSupportedThinkingLevels(supportedLevels);
  const isDisabled = orderedLevels.length === 0;

  return (
    <FormField
      control={control}
      name="default_thinking_level"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Thinking Level</FormLabel>
          <Select
            onValueChange={(value) =>
              field.onChange(value === INHERIT_THINKING_LEVEL ? null : value)
            }
            value={field.value ?? INHERIT_THINKING_LEVEL}
          >
            <FormControl>
              <SelectTrigger aria-label="Thinking level" disabled={isDisabled}>
                <SelectValue placeholder="Inherit / None" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value={INHERIT_THINKING_LEVEL}>
                Inherit / None
              </SelectItem>
              {orderedLevels.map((level) => (
                <SelectItem key={level} value={level}>
                  {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isDisabled && (
            <p className="text-sm text-muted-foreground">
              model has no configurable thinking levels
            </p>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}