import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { TelegramSettingsDraft } from "../telegramSettingsCard.types";
import { RELAY_NUMERIC_FIELDS } from "./TelegramFieldConfigs";
import { NumericSettingInput, ToggleSetting } from "./TelegramFieldControls";

interface TelegramRelaySectionProps {
  draft: TelegramSettingsDraft;
  onPatch: (patch: Partial<TelegramSettingsDraft>) => void;
}

export function TelegramRelaySection({
  draft,
  onPatch,
}: Readonly<TelegramRelaySectionProps>) {
  return (
    <AccordionItem value="relay">
      <AccordionTrigger>Relay</AccordionTrigger>
      <AccordionContent>
        <div className="space-y-4">
          <ToggleSetting
            id="telegram-relay-enabled"
            checked={draft.outboundRelayEnabled}
            label="Enable Outbound Relay"
            onCheckedChange={(checked) => {
              onPatch({ outboundRelayEnabled: checked });
            }}
          />
          <p className="text-xs text-muted-foreground">
            Relay sends terminal workflow outcomes back to Telegram users.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {RELAY_NUMERIC_FIELDS.map((field) => (
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
