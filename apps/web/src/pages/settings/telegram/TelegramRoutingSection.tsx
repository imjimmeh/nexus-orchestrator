import { TelegramIngressMode } from "@/lib/api/settings.types";
import { Input } from "@/components/ui/input";
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

interface TelegramRoutingSectionProps {
  draft: TelegramSettingsDraft;
  onPatch: (patch: Partial<TelegramSettingsDraft>) => void;
}

export function TelegramRoutingSection({
  draft,
  onPatch,
}: Readonly<TelegramRoutingSectionProps>) {
  return (
    <AccordionItem value="routing">
      <AccordionTrigger>Routing</AccordionTrigger>
      <AccordionContent>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="telegram-ingress-mode">Ingress Mode</Label>
            <Select
              value={draft.ingressMode}
              onValueChange={(value) => {
                onPatch({ ingressMode: value as TelegramIngressMode });
              }}
            >
              <SelectTrigger id="telegram-ingress-mode">
                <SelectValue placeholder="Select ingress mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="webhook">webhook</SelectItem>
                <SelectItem value="polling">polling</SelectItem>
                <SelectItem value="hybrid">hybrid</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="telegram-default-profile">
              Default Agent Profile
            </Label>
            <Input
              id="telegram-default-profile"
              value={draft.defaultAgentProfile}
              onChange={(event) => {
                onPatch({ defaultAgentProfile: event.target.value });
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="telegram-default-project">Default Project ID</Label>
            <Input
              id="telegram-default-project"
              placeholder="Optional"
              value={draft.defaultScopeId}
              onChange={(event) => {
                onPatch({ defaultScopeId: event.target.value });
              }}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="telegram-allowed-user-ids">
              Allowed Telegram User IDs
            </Label>
            <Textarea
              id="telegram-allowed-user-ids"
              placeholder={"123456789\n987654321"}
              value={draft.allowedUserIdsText}
              onChange={(event) => {
                onPatch({ allowedUserIdsText: event.target.value });
              }}
            />
            <p className="text-xs text-muted-foreground">
              Optional allowlist. Leave empty to allow all users. Enter one user
              ID per line or comma-separated.
            </p>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
