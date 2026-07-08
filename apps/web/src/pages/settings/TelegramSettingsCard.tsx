import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Send } from "lucide-react";
import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { TelegramSettingsGeneralFields } from "./TelegramSettingsGeneralFields";
import { TelegramSettingsSecretsFields } from "./TelegramSettingsSecretsFields";
import {
  buildUpdatePayload,
  getValidationError,
  toDraft,
} from "./telegramSettingsCard.helpers";
import { UpdateTelegramSettingsRequest } from "@/lib/api/settings.types";
import type {
  TelegramSecretDraft,
  TelegramSettingsDraft,
} from "./telegramSettingsCard.types";

const EMPTY_SECRET_DRAFT: TelegramSecretDraft = {
  botToken: "",
  webhookSecret: "",
  clearBotToken: false,
  clearWebhookSecret: false,
};

function TelegramSettingsContent(
  props: Readonly<{
    settings: {
      hasBotToken: boolean;
      hasWebhookSecret: boolean;
    };
    draft: TelegramSettingsDraft;
    secretDraft: TelegramSecretDraft;
    updateDraft: (patch: Partial<TelegramSettingsDraft>) => void;
    updateSecret: (patch: Partial<TelegramSecretDraft>) => void;
    validationError: string | null;
    handleSave: () => void;
    isSaveDisabled: boolean;
    isPending: boolean;
  }>,
) {
  const {
    settings,
    draft,
    secretDraft,
    updateDraft,
    updateSecret,
    validationError,
    handleSave,
    isSaveDisabled,
    isPending,
  } = props;

  return (
    <>
      <Accordion type="multiple" defaultValue={["routing"]}>
        <TelegramSettingsGeneralFields draft={draft} onPatch={updateDraft} />
        <TelegramSettingsSecretsFields
          hasBotToken={settings.hasBotToken}
          hasWebhookSecret={settings.hasWebhookSecret}
          botToken={secretDraft.botToken}
          webhookSecret={secretDraft.webhookSecret}
          clearBotToken={secretDraft.clearBotToken}
          clearWebhookSecret={secretDraft.clearWebhookSecret}
          onBotTokenChange={(value) => {
            updateSecret({ botToken: value });
          }}
          onWebhookSecretChange={(value) => {
            updateSecret({ webhookSecret: value });
          }}
          onClearBotTokenChange={(checked) => {
            updateSecret({ clearBotToken: checked });
          }}
          onClearWebhookSecretChange={(checked) => {
            updateSecret({ clearWebhookSecret: checked });
          }}
        />
      </Accordion>
      {validationError && (
        <p className="text-sm text-destructive">{validationError}</p>
      )}
      <div className="flex items-center justify-end">
        <Button onClick={handleSave} disabled={isSaveDisabled || isPending}>
          {isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Telegram Settings
        </Button>
      </div>
    </>
  );
}

export function TelegramSettingsCard() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: queryKeys.settings.telegram(),
    queryFn: () => api.getTelegramSettings(),
  });

  const [draft, setDraft] = useState<TelegramSettingsDraft | null>(null);
  const [secretDraft, setSecretDraft] =
    useState<TelegramSecretDraft>(EMPTY_SECRET_DRAFT);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setDraft(toDraft(settings));
    setSecretDraft(EMPTY_SECRET_DRAFT);
  }, [settings]);

  const validationError = useMemo(
    () => getValidationError(draft, secretDraft),
    [draft, secretDraft],
  );

  const updatePayload = useMemo<UpdateTelegramSettingsRequest | null>(
    () => buildUpdatePayload({ settings, draft, secretDraft }),
    [draft, secretDraft, settings],
  );

  const updateMutation = useMutation({
    mutationFn: (payload: UpdateTelegramSettingsRequest) =>
      api.updateTelegramSettings(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.settings.telegram(),
      });
    },
  });

  const updateDraft = (patch: Partial<TelegramSettingsDraft>) => {
    setDraft((previous) => (previous ? { ...previous, ...patch } : previous));
  };

  const updateSecret = (patch: Partial<TelegramSecretDraft>) => {
    setSecretDraft((previous) => ({ ...previous, ...patch }));
  };

  const isSaveDisabled =
    isLoading ||
    !settings ||
    !draft ||
    !updatePayload ||
    validationError !== null;

  const handleSave = () => {
    if (!updatePayload || validationError) {
      return;
    }

    updateMutation.mutate(updatePayload);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          Telegram Integration
        </CardTitle>
        <CardDescription>
          Configure ingress mode, routing defaults, polling cadence, relay
          behavior, user allowlist, and encrypted Telegram credentials.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!settings || !draft ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <TelegramSettingsContent
            settings={settings}
            draft={draft}
            secretDraft={secretDraft}
            updateDraft={updateDraft}
            updateSecret={updateSecret}
            validationError={validationError}
            handleSave={handleSave}
            isSaveDisabled={isSaveDisabled}
            isPending={updateMutation.isPending}
          />
        )}
      </CardContent>
    </Card>
  );
}
