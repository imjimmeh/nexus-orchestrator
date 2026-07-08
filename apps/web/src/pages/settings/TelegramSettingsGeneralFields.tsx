import type { TelegramSettingsDraft } from "./telegramSettingsCard.types";
import { TelegramRoutingSection } from "./telegram/TelegramRoutingSection";
import { TelegramPollingSection } from "./telegram/TelegramPollingSection";
import { TelegramRelaySection } from "./telegram/TelegramRelaySection";
import { TelegramCommandsSection } from "./telegram/TelegramCommandsSection";
import { TelegramUxStatusSection } from "./telegram/TelegramUxStatusSection";

interface TelegramSettingsGeneralFieldsProps {
  draft: TelegramSettingsDraft;
  onPatch: (patch: Partial<TelegramSettingsDraft>) => void;
}

export function TelegramSettingsGeneralFields(
  props: Readonly<TelegramSettingsGeneralFieldsProps>,
) {
  const { draft, onPatch } = props;

  return (
    <>
      <TelegramRoutingSection draft={draft} onPatch={onPatch} />
      <TelegramPollingSection draft={draft} onPatch={onPatch} />
      <TelegramRelaySection draft={draft} onPatch={onPatch} />
      <TelegramCommandsSection draft={draft} onPatch={onPatch} />
      <TelegramUxStatusSection draft={draft} onPatch={onPatch} />
    </>
  );
}
