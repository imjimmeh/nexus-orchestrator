import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { createCrudHooks } from "./lib/createCrudHooks";
import {
  createHarness,
  deleteHarness,
  getHarness,
  listHarnesses,
  updateHarness,
  validateHarness,
} from "@/lib/api/harness-api";
import type {
  CreateHarnessRequest,
  HarnessDefinition,
  UpdateHarnessRequest,
} from "@/lib/api/harness-api.types";

const { useList, useOne, useCreate, useUpdate, useRemove } = createCrudHooks<
  HarnessDefinition,
  CreateHarnessRequest,
  UpdateHarnessRequest
>(queryKeys.harnesses, {
  getAll: () => listHarnesses(api),
  getOne: (id) => getHarness(api, id),
  create: (data) => createHarness(api, data),
  update: (id, data) => updateHarness(api, id, data),
  remove: (id) => deleteHarness(api, id),
});

export const useHarnesses = useList;
export const useHarness = useOne;
export const useCreateHarness = useCreate;
export const useUpdateHarness = useUpdate;
export const useDeleteHarness = useRemove;

export function useValidateHarness() {
  return useMutation({
    mutationFn: (harnessId: string) => validateHarness(api, harnessId),
  });
}
