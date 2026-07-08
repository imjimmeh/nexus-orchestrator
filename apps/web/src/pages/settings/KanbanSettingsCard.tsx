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
import { KanbanSetting } from "@/lib/api/settings.types";
import { SystemSettingsBooleanRow } from "./SystemSettingsRow.Boolean";
import { SystemSettingsNumberRow } from "./SystemSettingsRow.Number";
import {
  KANBAN_SETTING_GROUPS,
  KNOWN_KANBAN_SETTINGS,
} from "./kanbanSettings.constants";
import {
  buildKanbanSettingsEditState,
  groupKanbanSettings,
} from "./kanbanSettings.helpers";

type EditState = ReturnType<typeof buildKanbanSettingsEditState>;

const EMPTY_KANBAN_SETTINGS: KanbanSetting[] = [];

function SettingRow(
  props: Readonly<{
    setting: KanbanSetting;
    editState: EditState;
    isUpdating: boolean;
    onEditStateChange: (next: EditState) => void;
    onSave: (value: unknown) => void;
  }>,
) {
  const { setting, editState, isUpdating, onEditStateChange, onSave } = props;
  const config = KNOWN_KANBAN_SETTINGS[setting.key];
  if (!config) {
    return null;
  }

  if (config.type === "boolean") {
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
  }

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
}

export function KanbanSettingsCard() {
  const queryClient = useQueryClient();
  const { data: settings = EMPTY_KANBAN_SETTINGS, isLoading } = useQuery({
    queryKey: queryKeys.settings.kanban(),
    queryFn: () => api.getKanbanSettings(),
  });

  const [editState, setEditState] = useState<EditState>(() =>
    buildKanbanSettingsEditState([]),
  );

  useEffect(() => {
    setEditState(buildKanbanSettingsEditState(settings));
  }, [settings]);

  const groupedSettings = useMemo(
    () => groupKanbanSettings(settings),
    [settings],
  );

  const updateMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) =>
      api.updateKanbanSetting(key, value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.settings.kanban(),
      });
    },
  });

  const saveSetting = (setting: KanbanSetting, value: unknown) => {
    updateMutation.mutate({ key: setting.key, value });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cog className="h-5 w-5" />
            Kanban Settings
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
          Kanban Settings
        </CardTitle>
        <CardDescription>
          Kanban dispatch, work-item, and project orchestration settings served
          by the Kanban API.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" defaultValue={["dispatch"]}>
          {KANBAN_SETTING_GROUPS.map((group) => {
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
        {updateMutation.isError && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            Failed to save Kanban setting: {updateMutation.error.message}
          </p>
        )}
        {settings.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No Kanban settings configured.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
