import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";

interface TelegramSettingsSecretsFieldsProps {
  hasBotToken: boolean;
  hasWebhookSecret: boolean;
  botToken: string;
  webhookSecret: string;
  clearBotToken: boolean;
  clearWebhookSecret: boolean;
  onBotTokenChange: (value: string) => void;
  onWebhookSecretChange: (value: string) => void;
  onClearBotTokenChange: (checked: boolean) => void;
  onClearWebhookSecretChange: (checked: boolean) => void;
}

export function TelegramSettingsSecretsFields(
  props: TelegramSettingsSecretsFieldsProps,
) {
  const {
    hasBotToken,
    hasWebhookSecret,
    botToken,
    webhookSecret,
    clearBotToken,
    clearWebhookSecret,
    onBotTokenChange,
    onWebhookSecretChange,
    onClearBotTokenChange,
    onClearWebhookSecretChange,
  } = props;

  return (
    <AccordionItem value="secrets">
      <AccordionTrigger>Secrets</AccordionTrigger>
      <AccordionContent>
        <p className="text-xs text-muted-foreground mb-4">
          Secret values are write-only from UI. Existing values are never
          exposed.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="telegram-bot-token">Bot Token</Label>
            <Input
              id="telegram-bot-token"
              type="password"
              placeholder={
                hasBotToken ? "Stored token is configured" : "Set new bot token"
              }
              value={botToken}
              onChange={(event) => {
                onBotTokenChange(event.target.value);
              }}
            />
            <div className="flex items-center gap-3">
              <Checkbox
                id="telegram-clear-bot-token"
                checked={clearBotToken}
                onCheckedChange={(checked) => {
                  onClearBotTokenChange(checked === true);
                }}
              />
              <Label htmlFor="telegram-clear-bot-token">
                Clear stored bot token
              </Label>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="telegram-webhook-secret">Webhook Secret</Label>
            <Input
              id="telegram-webhook-secret"
              type="password"
              placeholder={
                hasWebhookSecret
                  ? "Stored secret is configured"
                  : "Set new webhook secret"
              }
              value={webhookSecret}
              onChange={(event) => {
                onWebhookSecretChange(event.target.value);
              }}
            />
            <div className="flex items-center gap-3">
              <Checkbox
                id="telegram-clear-webhook-secret"
                checked={clearWebhookSecret}
                onCheckedChange={(checked) => {
                  onClearWebhookSecretChange(checked === true);
                }}
              />
              <Label htmlFor="telegram-clear-webhook-secret">
                Clear stored webhook secret
              </Label>
            </div>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
