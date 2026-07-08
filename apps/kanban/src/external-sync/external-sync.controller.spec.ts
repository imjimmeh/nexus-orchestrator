import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ExternalSyncController } from "./external-sync.controller.js";
import type {
  ExternalConnectionRecord,
  SyncOperationRecord,
  TestConnectionResult,
} from "./external-sync.types.js";

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";
const CONNECTION_ID = "660e8400-e29b-41d4-a716-446655440001";
const nowIso = "2026-06-01T00:00:00.000Z";

function buildRecord(
  overrides: Partial<ExternalConnectionRecord> = {},
): ExternalConnectionRecord {
  return {
    id: CONNECTION_ID,
    project_id: PROJECT_ID,
    provider_type: "null",
    name: "Test",
    status: "active",
    sync_mode: "bidirectional",
    sync_transport: "manual",
    config: {},
    field_mapping: {},
    webhook_secret_ref: null,
    poll_interval_seconds: null,
    last_sync_at: null,
    last_sync_error: null,
    created_at: nowIso,
    updated_at: nowIso,
    ...overrides,
  };
}

describe("ExternalSyncController", () => {
  function createController() {
    const createMock = vi.fn();
    const listByProjectMock = vi.fn();
    const getByProjectAndIdMock = vi.fn();
    const updateByProjectAndIdMock = vi.fn();
    const deleteByProjectAndIdMock = vi.fn();
    const testMock = vi.fn();
    const pauseMock = vi.fn();
    const resumeMock = vi.fn();
    const listOperationsMock = vi.fn();
    const syncMock = vi.fn();
    const importMock = vi.fn();
    const exportMock = vi.fn();

    const service = {
      create: createMock,
      listByProject: listByProjectMock,
      getByProjectAndId: getByProjectAndIdMock,
      updateByProjectAndId: updateByProjectAndIdMock,
      deleteByProjectAndId: deleteByProjectAndIdMock,
      test: testMock,
      pause: pauseMock,
      resume: resumeMock,
      listOperations: listOperationsMock,
      sync: syncMock,
      import: importMock,
      exportWorkItems: exportMock,
    };

    const controller = new ExternalSyncController(service as never);

    return {
      controller,
      createMock,
      listByProjectMock,
      getByProjectAndIdMock,
      updateByProjectAndIdMock,
      deleteByProjectAndIdMock,
      testMock,
      pauseMock,
      resumeMock,
      listOperationsMock,
      syncMock,
      importMock,
      exportMock,
    };
  }

  describe("POST /projects/:projectId/external-connections", () => {
    it("returns { success: true, data } on create", async () => {
      const record = buildRecord();
      const { controller, createMock } = createController();
      createMock.mockResolvedValue(record);

      const result = await controller.create(PROJECT_ID, {
        provider_type: "null",
        name: "Test",
      });

      expect(result).toEqual({ success: true, data: record });
      expect(createMock).toHaveBeenCalledWith(PROJECT_ID, {
        provider_type: "null",
        name: "Test",
      });
    });

    it("rejects empty provider_type", async () => {
      const { controller, createMock } = createController();
      createMock.mockRejectedValue(
        new BadRequestException("provider_type is required"),
      );

      await expect(
        controller.create(PROJECT_ID, { provider_type: "", name: "X" }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("GET /projects/:projectId/external-connections", () => {
    it("returns { success: true, data } with list", async () => {
      const records = [buildRecord()];
      const { controller, listByProjectMock } = createController();
      listByProjectMock.mockResolvedValue(records);

      const result = await controller.list(PROJECT_ID);

      expect(result).toEqual({ success: true, data: records });
      expect(listByProjectMock).toHaveBeenCalledWith(PROJECT_ID);
    });
  });

  describe("GET /projects/:projectId/external-connections/:id", () => {
    it("returns { success: true, data } on get", async () => {
      const record = buildRecord();
      const { controller, getByProjectAndIdMock } = createController();
      getByProjectAndIdMock.mockResolvedValue(record);

      const result = await controller.get(PROJECT_ID, CONNECTION_ID);

      expect(result).toEqual({ success: true, data: record });
      expect(getByProjectAndIdMock).toHaveBeenCalledWith(
        PROJECT_ID,
        CONNECTION_ID,
      );
    });

    it("rejects with NotFoundException when missing", async () => {
      const { controller, getByProjectAndIdMock } = createController();
      getByProjectAndIdMock.mockRejectedValue(new NotFoundException());

      await expect(
        controller.get(PROJECT_ID, "missing"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("PATCH /projects/:projectId/external-connections/:id", () => {
    it("returns { success: true, data } on update", async () => {
      const updated = buildRecord({ name: "Renamed" });
      const { controller, updateByProjectAndIdMock } = createController();
      updateByProjectAndIdMock.mockResolvedValue(updated);

      const result = await controller.update(PROJECT_ID, CONNECTION_ID, {
        name: "Renamed",
      });

      expect(result).toEqual({ success: true, data: updated });
      expect(updateByProjectAndIdMock).toHaveBeenCalledWith(
        PROJECT_ID,
        CONNECTION_ID,
        { name: "Renamed" },
      );
    });

    it("rejects with NotFoundException when missing", async () => {
      const { controller, updateByProjectAndIdMock } = createController();
      updateByProjectAndIdMock.mockRejectedValue(new NotFoundException());

      await expect(
        controller.update(PROJECT_ID, "missing", { name: "X" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("DELETE /projects/:projectId/external-connections/:id", () => {
    it("returns { success: true, data: null } on delete", async () => {
      const { controller, deleteByProjectAndIdMock } = createController();
      deleteByProjectAndIdMock.mockResolvedValue(null);

      const result = await controller.delete(PROJECT_ID, CONNECTION_ID);

      expect(result).toEqual({ success: true, data: null });
      expect(deleteByProjectAndIdMock).toHaveBeenCalledWith(
        PROJECT_ID,
        CONNECTION_ID,
      );
    });

    it("rejects with NotFoundException when missing", async () => {
      const { controller, deleteByProjectAndIdMock } = createController();
      deleteByProjectAndIdMock.mockRejectedValue(new NotFoundException());

      await expect(
        controller.delete(PROJECT_ID, "missing"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("POST /projects/:projectId/external-connections/:id/test", () => {
    it("returns { success: true, data } with test result", async () => {
      const testResult: TestConnectionResult = {
        provider_type: "null",
        valid: true,
      };
      const { controller, testMock } = createController();
      testMock.mockResolvedValue(testResult);

      const result = await controller.test(PROJECT_ID, CONNECTION_ID);

      expect(result).toEqual({ success: true, data: testResult });
      expect(testMock).toHaveBeenCalledWith(PROJECT_ID, CONNECTION_ID);
    });
  });

  describe("POST /projects/:projectId/external-connections/:id/pause", () => {
    it("returns { success: true, data } with paused connection", async () => {
      const paused = buildRecord({ status: "paused" });
      const { controller, pauseMock } = createController();
      pauseMock.mockResolvedValue(paused);

      const result = await controller.pause(PROJECT_ID, CONNECTION_ID);

      expect(result).toEqual({ success: true, data: paused });
      expect(pauseMock).toHaveBeenCalledWith(PROJECT_ID, CONNECTION_ID);
    });
  });

  describe("POST /projects/:projectId/external-connections/:id/resume", () => {
    it("returns { success: true, data } with resumed connection", async () => {
      const active = buildRecord({ status: "active" });
      const { controller, resumeMock } = createController();
      resumeMock.mockResolvedValue(active);

      const result = await controller.resume(PROJECT_ID, CONNECTION_ID);

      expect(result).toEqual({ success: true, data: active });
      expect(resumeMock).toHaveBeenCalledWith(PROJECT_ID, CONNECTION_ID);
    });
  });

  describe("POST /projects/:projectId/external-connections/:id/sync", () => {
    it("returns { success: true, data } with sync result", async () => {
      const syncResult = {
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
      };
      const { controller, syncMock } = createController();
      syncMock.mockResolvedValue(syncResult);

      const result = await controller.sync(PROJECT_ID, CONNECTION_ID);

      expect(result).toEqual({ success: true, data: syncResult });
      expect(syncMock).toHaveBeenCalledWith(PROJECT_ID, CONNECTION_ID);
    });
  });

  describe("POST /projects/:projectId/external-connections/:id/import", () => {
    it("returns { success: true, data } with import result", async () => {
      const importResult = {
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
      };
      const { controller, importMock } = createController();
      importMock.mockResolvedValue(importResult);

      const result = await controller.import(PROJECT_ID, CONNECTION_ID);

      expect(result).toEqual({ success: true, data: importResult });
      expect(importMock).toHaveBeenCalledWith(PROJECT_ID, CONNECTION_ID);
    });
  });

  describe("POST /projects/:projectId/external-connections/:id/export", () => {
    it("returns { success: true, data } with export result", async () => {
      const exportResult = {
        processed: 2,
        created: 0,
        updated: 2,
        skipped: 0,
        failed: 0,
      };
      const { controller, exportMock } = createController();
      exportMock.mockResolvedValue(exportResult);

      const result = await controller.export(PROJECT_ID, CONNECTION_ID);

      expect(result).toEqual({ success: true, data: exportResult });
      expect(exportMock).toHaveBeenCalledWith(PROJECT_ID, CONNECTION_ID);
    });
  });

  describe("GET /projects/:projectId/external-connections/:id/operations", () => {
    it("returns { success: true, data } with operations list", async () => {
      const ops = [{ id: "op-1" } as SyncOperationRecord];
      const { controller, listOperationsMock } = createController();
      listOperationsMock.mockResolvedValue(ops);

      const result = await controller.operations(
        PROJECT_ID,
        CONNECTION_ID,
        undefined,
        undefined,
      );

      expect(result).toEqual({ success: true, data: ops });
      expect(listOperationsMock).toHaveBeenCalledWith(
        PROJECT_ID,
        CONNECTION_ID,
        50,
        0,
      );
    });

    it("passes limit and offset from query params", async () => {
      const { controller, listOperationsMock } = createController();
      listOperationsMock.mockResolvedValue([]);

      await controller.operations(PROJECT_ID, CONNECTION_ID, "10", "5");

      expect(listOperationsMock).toHaveBeenCalledWith(
        PROJECT_ID,
        CONNECTION_ID,
        10,
        5,
      );
    });

    it("handles invalid query params gracefully", async () => {
      const { controller, listOperationsMock } = createController();
      listOperationsMock.mockResolvedValue([]);

      await controller.operations(PROJECT_ID, CONNECTION_ID, "abc", "xyz");

      expect(listOperationsMock).toHaveBeenCalledWith(
        PROJECT_ID,
        CONNECTION_ID,
        50,
        0,
      );
    });
  });
});
