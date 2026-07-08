import {
  FormControl,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ModelFormPresetOption } from "./ModelForm.hooks.types";

interface ModelFormPresetSelectProps {
  presets: ModelFormPresetOption[];
  onChange: (presetId: string) => void;
}

export function ModelFormPresetSelect({
  presets,
  onChange,
}: Readonly<ModelFormPresetSelectProps>) {
  return (
    <FormItem>
      <FormLabel>Preset Model (Optional)</FormLabel>
      <Select onValueChange={onChange} defaultValue="custom">
        <FormControl>
          <SelectTrigger>
            <SelectValue placeholder="Custom / Choose preset..." />
          </SelectTrigger>
        </FormControl>
        <SelectContent>
          <SelectItem value="custom">Custom (Manual Setup)</SelectItem>
          {presets.map((preset) => (
            <SelectItem key={preset.id} value={preset.id}>
              {preset.name} ({preset.provider})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormItem>
  );
}