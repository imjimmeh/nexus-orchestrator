import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cog } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { SystemSetting } from "@/lib/api/settings.types";
import { SystemSettingsBooleanRow } from "./SystemSettingsRow.Boolean";
import { SystemSettingsJsonRow } from "./SystemSettingsRow.Json";
import { SystemSettingsNumberRow } from "./SystemSettingsRow.Number";
import { SystemSettingsStringArrayRow } from "./SystemSettingsRow.StringArray";
import {
  KNOWN_SETTINGS,
  SETTING_GROUPS,
} from "./systemSettings.constants";
import {
  buildSystemSettingsEditState,
  groupSystemSettings,
} from "./systemSettings.helpers";

type EditState = ReturnType<typeof buildSystemSettingsEditState>;

function SettingRow(
  props: Readonly<{
    setting: SystemSetting;
    editState: EditState;
    isUpdating: boolean;
    onEditStateChange: (next: EditState) => void;
    onSave: (value: unknown) => void;
  }>,
) {
  const { setting, editState, isUpdating, onEditStateChange, onSave } = props;
  const config = KNOWN_SETTINGS[setting.key];
  if (!config) {
    return null;
  }

  switch (config.type) {
    case "boolean":
      return (
        <SystemSettingsBooleanRow
          setting={setting}
          label={config.label}
          description={config.description}
          value={editState.booleans[setting.key] ?? false}
          isUpdating={isUpdating}
          onValueChange={(next) =>
            onEditStateChange({
              ...editState,
              booleans: { ...editState.booleans, [setting.key]: next },
            })
          }
          onSave={onSave}
        />
      );
    case "number":
      return (
        <SystemSettingsNumberRow
          setting={setting}
          label={config.label}
          description={config.description}
          min={config.min}
          max={config.max}
          value={editState.numbers[setting.key] ?? ""}
          isUpdating={isUpdating}
          onValueChange={(next) =>
            onEditStateChange({
              ...editState,
              numbers: { ...editState.numbers, [setting.key]: next },
            })
          }
          onSave={onSave}
        />
      );
    case "string_array":
      return (
        <SystemSettingsStringArrayRow
          setting={setting}
          label={config.label}
          description={config.description}
          value={editState.stringArrays[setting.key] ?? []}
          isUpdating={isUpdating}
          onValueChange={(next) =>
            onEditStateChange({
              ...editState,
              stringArrays: {
                ...editState.stringArrays,
                [setting.key]: next,
              },
            })
          }
          onSave={onSave}
        />
      );
    case "json":
      return (
        <SystemSettingsJsonRow
          setting={setting}
          label={config.label}
          description={config.description}
          value={editState.jsonObjects[setting.key] ?? {}}
          isUpdating={isUpdating}
          onValueChange={(next) =>
            onEditStateChange({
              ...editState,
              jsonObjects: { ...editState.jsonObjects, [setting.key]: next },
            })
          }
          onSave={onSave}
        />
      );
  }
}

export function SystemSettingsCard() {
  const queryClient = useQueryClient();
  const { data: settings = [], isLoading } = useQuery({
    queryKey: queryKeys.settings.system(),
    queryFn: () => api.getSystemSettings(),
  });

  const [editState, setEditState] = useState<EditState>(() =>
    buildSystemSettingsEditState([]),
  );

  useEffect(() => {
    setEditState(buildSystemSettingsEditState(settings));
  }, [settings]);

  const groupedSettings = useMemo(
    () => groupSystemSettings(settings),
    [settings],
  );

  const updateMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      return api.updateSystemSetting(key, value);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.settings.system(),
      });
    },
  });

  const saveSetting = (setting: SystemSetting, value: unknown) => {
    updateMutation.mutate({ key: setting.key, value });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cog className="h-5 w-5" />
            System Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cog className="h-5 w-5" />
          System Settings
        </CardTitle>
        <CardDescription>
          Global platform settings. Changes take effect immediately.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" defaultValue={["dispatch"]}>
          {SETTING_GROUPS.map((group) => {
            const groupSettings = groupedSettings[group.value];
            if (!groupSettings || groupSettings.length === 0) {
              return null;
            }
            return (
              <AccordionItem key={group.value} value={group.value}>
                <AccordionTrigger className="text-sm font-medium">
                  {group.label}
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-4">
                    {groupSettings.map((setting) => (
                      <SettingRow
                        key={setting.key}
                        setting={setting}
                        editState={editState}
                        isUpdating={updateMutation.isPending}
                        onEditStateChange={setEditState}
                        onSave={(value) => saveSetting(setting, value)}
                      />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
        {settings.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No system settings configured.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
