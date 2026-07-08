import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { TelegramSettingsDraft } from "../telegramSettingsCard.types";
import { POLLING_NUMERIC_FIELDS } from "./TelegramFieldConfigs";
import { NumericSettingInput } from "./TelegramFieldControls";

interface TelegramPollingSectionProps {
  draft: TelegramSettingsDraft;
  onPatch: (patch: Partial<TelegramSettingsDraft>) => void;
}

export function TelegramPollingSection({
  draft,
  onPatch,
}: Readonly<TelegramPollingSectionProps>) {
  return (
    <AccordionItem value="polling">
      <AccordionTrigger>Polling</AccordionTrigger>
      <AccordionContent>
        <div className="grid gap-4 md:grid-cols-2">
          {POLLING_NUMERIC_FIELDS.map((field) => (
            <NumericSettingInput
              key={field.key}
              draft={draft}
              field={field}
              onPatch={onPatch}
            />
          ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
