import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { TelegramSettingsDraft } from "../telegramSettingsCard.types";
import { COMMANDS_NUMERIC_FIELDS } from "./TelegramFieldConfigs";
import { NumericSettingInput, ToggleSetting } from "./TelegramFieldControls";

interface TelegramCommandsSectionProps {
  draft: TelegramSettingsDraft;
  onPatch: (patch: Partial<TelegramSettingsDraft>) => void;
}

export function TelegramCommandsSection({
  draft,
  onPatch,
}: Readonly<TelegramCommandsSectionProps>) {
  return (
    <AccordionItem value="commands">
      <AccordionTrigger>Commands</AccordionTrigger>
      <AccordionContent>
        <div className="space-y-4">
          <ToggleSetting
            id="telegram-commands-enabled"
            checked={draft.commandsEnabled}
            label="Enable Slash Commands"
            onCheckedChange={(checked) => {
              onPatch({ commandsEnabled: checked });
            }}
          />
          <div className="space-y-2">
            <Label htmlFor="telegram-enabled-commands">Enabled Commands</Label>
            <Textarea
              id="telegram-enabled-commands"
              placeholder={"help\nnew\nresume\nagent"}
              value={draft.enabledCommandsText}
              onChange={(event) => {
                onPatch({ enabledCommandsText: event.target.value });
              }}
            />
            <p className="text-xs text-muted-foreground">
              One command per line or comma-separated. Use command names without
              leading slash.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {COMMANDS_NUMERIC_FIELDS.map((field) => (
              <NumericSettingInput
                key={field.key}
                draft={draft}
                field={field}
                onPatch={onPatch}
              />
            ))}
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
