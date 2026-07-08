import { TelegramStatusMode } from "@/lib/api/settings.types";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TelegramSettingsDraft } from "../telegramSettingsCard.types";
import { UX_NUMERIC_FIELDS } from "./TelegramFieldConfigs";
import { NumericSettingInput, ToggleSetting } from "./TelegramFieldControls";

interface TelegramUxStatusSectionProps {
  draft: TelegramSettingsDraft;
  onPatch: (patch: Partial<TelegramSettingsDraft>) => void;
}

export function TelegramUxStatusSection({
  draft,
  onPatch,
}: Readonly<TelegramUxStatusSectionProps>) {
  return (
    <AccordionItem value="ux">
      <AccordionTrigger>UX &amp; Status</AccordionTrigger>
      <AccordionContent>
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <ToggleSetting
              id="telegram-ux-typing-enabled"
              checked={draft.uxTypingEnabled}
              label="Enable Typing Indicators"
              onCheckedChange={(checked) => {
                onPatch({ uxTypingEnabled: checked });
              }}
            />
            <ToggleSetting
              id="telegram-ux-status-updates-enabled"
              checked={draft.uxStatusUpdatesEnabled}
              label="Enable Progress Status Updates"
              onCheckedChange={(checked) => {
                onPatch({ uxStatusUpdatesEnabled: checked });
              }}
            />
            <ToggleSetting
              id="telegram-ux-hide-thinking"
              checked={draft.uxHideThinking}
              label="Hide Thinking"
              onCheckedChange={(checked) => {
                onPatch({ uxHideThinking: checked });
              }}
            />
            <ToggleSetting
              id="telegram-ux-expose-tool-names"
              checked={draft.uxExposeToolNames}
              label="Expose Tool Names in Progress Updates"
              onCheckedChange={(checked) => {
                onPatch({ uxExposeToolNames: checked });
              }}
            />
            <ToggleSetting
              id="telegram-ux-command-menu-sync-enabled"
              checked={draft.uxCommandMenuSyncEnabled}
              label="Enable Command Menu Sync"
              onCheckedChange={(checked) => {
                onPatch({ uxCommandMenuSyncEnabled: checked });
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="telegram-ux-status-mode">Status Message Mode</Label>
            <Select
              value={draft.uxStatusMode}
              onValueChange={(value) => {
                onPatch({ uxStatusMode: value as TelegramStatusMode });
              }}
            >
              <SelectTrigger id="telegram-ux-status-mode">
                <SelectValue placeholder="Select status mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single_message">single_message</SelectItem>
                <SelectItem value="multi_message">multi_message</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="telegram-progress-events-allowlist">
              Progress Events Allowlist
            </Label>
            <Textarea
              id="telegram-progress-events-allowlist"
              placeholder={"job_start\nagent_prompt_sent\ntool_execution_start"}
              value={draft.uxProgressEventsAllowlistText}
              onChange={(event) => {
                onPatch({ uxProgressEventsAllowlistText: event.target.value });
              }}
            />
            <p className="text-xs text-muted-foreground">
              Workflow event types eligible for user-facing Telegram progress
              updates.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {UX_NUMERIC_FIELDS.map((field) => (
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
