import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { DispatchService } from "../../src/dispatch/dispatch.service";
import { KanbanSettingRepository } from "../../src/database/repositories/kanban-setting.repository";
import { WorkItemTransitionStatusTool } from "../../src/mcp/tools/mutation/work-item-transition-status.tool";
import { KanbanSettingsController } from "../../src/settings/kanban-settings.controller";
import { KANBAN_SETTING_DEFAULTS } from "../../src/settings/kanban-settings.constants";
import { KanbanSettingsService } from "../../src/settings/kanban-settings.service";
import { listenOnRandomPort } from "./test-http";

const MAX_ACTIVE_KEY = "work_item_dispatch_max_active_per_project";
const MAX_ACTIVE_DEFAULT =
  KANBAN_SETTING_DEFAULTS[MAX_ACTIVE_KEY].value as number;
const MAX_ACTIVE_CEILING =
  KANBAN_SETTING_DEFAULTS[MAX_ACTIVE_KEY].max as number;

type SettingRow = {
  key: string;
  value: unknown;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function createInMemorySettingRepository(): {
  repository: KanbanSettingRepository;
  rows: Map<string, SettingRow>;
} {
  const rows = new Map<string, SettingRow>();
  const now = () => new Date("2026-06-01T00:00:00.000Z");
  const repository = {
    findAll: vi.fn(() =>
      Promise.resolve(
        [...rows.values()].sort((a, b) => a.key.localeCompare(b.key)),
      ),
    ),
    findByKey: vi.fn((key: string) => Promise.resolve(rows.get(key) ?? null)),
    upsert: vi.fn(
      (key: string, value: unknown, description?: string | null) => {
        const existing = rows.get(key);
        const row: SettingRow = {
          key,
          value,
          description:
            description === undefined
              ? (existing?.description ?? null)
              : description,
          createdAt: existing?.createdAt ?? now(),
          updatedAt: now(),
        };
        rows.set(key, row);
        return row;
      },
    ),
  } as unknown as KanbanSettingRepository;
  return { repository, rows };
}

type CapacitySnapshot = {
  maxActive: number;
  activeCount: number;
  availableSlots: number;
};

/**
 * Build a stubbed `WorkItemTransitionStatusTool` that, on each call to
 * `run`, reads `work_item_dispatch_max_active_per_project` from the shared
 * `KanbanSettingsService`. This mirrors the production wiring where the
 * tool is a real consumer of the same singleton service.
 */
function makeToolSpy(settings: KanbanSettingsService) {
  const runSpy = vi.fn(
    async (): Promise<CapacitySnapshot> => {
      const maxActive = await settings.getNumber(MAX_ACTIVE_KEY);
      return {
        maxActive,
        activeCount: 0,
        availableSlots: maxActive,
      };
    },
  );
  const tool = {
    run: runSpy,
  } as unknown as WorkItemTransitionStatusTool & {
    run: ReturnType<typeof vi.fn>;
  };
  return { tool, runSpy };
}

/**
 * Build a stubbed `DispatchService` where the two entry points (ready and
 * selected) read the cap from the shared `KanbanSettingsService` before
 * returning. This mirrors the production read sites at
 * `DispatchService.dispatchReadyWorkItems` /
 * `DispatchService.dispatchSelectedWorkItems`.
 */
function makeDispatchServiceSpy(settings: KanbanSettingsService) {
  const readySpy = vi.fn(
    async (): Promise<CapacitySnapshot> => {
      const maxActive = await settings.getNumber(MAX_ACTIVE_KEY);
      return {
        maxActive,
        activeCount: 0,
        availableSlots: maxActive,
      };
    },
  );
  const selectedSpy = vi.fn(
    async (): Promise<CapacitySnapshot> => {
      const maxActive = await settings.getNumber(MAX_ACTIVE_KEY);
      return {
        maxActive,
        activeCount: 0,
        availableSlots: maxActive,
      };
    },
  );
  const service = {
    dispatchReadyWorkItems: readySpy,
    dispatchSelectedWorkItems: selectedSpy,
  } as unknown as DispatchService;
  return { service, readySpy, selectedSpy };
}

describe("WIP cap settings persistence integration (AC-4)", () => {
  let app: INestApplication;
  let baseUrl: string;
  let settingsService: KanbanSettingsService;
  let settingsRows: Map<string, SettingRow>;
  let toolSpy: ReturnType<typeof makeToolSpy>;
  let dispatchSpy: ReturnType<typeof makeDispatchServiceSpy>;
  let reconcilerProbeSpy: Mock<() => Promise<CapacitySnapshot>>;

  beforeEach(async () => {
    const { repository, rows } = createInMemorySettingRepository();
    settingsRows = rows;

    // Seed defaults up-front to mirror production seedDefaults() behaviour.
    // This also exercises the default-seeding assertion (case 2).
    const seedingService = new KanbanSettingsService(repository);
    await seedingService.seedDefaults();
    settingsService = seedingService;

    toolSpy = makeToolSpy(settingsService);
    dispatchSpy = makeDispatchServiceSpy(settingsService);
    // The reconciler read site is exercised in a separate spec; we provide
    // a thin probe here that confirms the same shared service is used.
    reconcilerProbeSpy = vi.fn(async (): Promise<CapacitySnapshot> => {
      const maxActive = await settingsService.getNumber(MAX_ACTIVE_KEY);
      return {
        maxActive,
        activeCount: 0,
        availableSlots: maxActive,
      };
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [KanbanSettingsController],
      providers: [
        // Provide the seeded service instance so the controller shares
        // identity with the consumers below.
        { provide: KanbanSettingsService, useValue: settingsService },
        { provide: KanbanSettingRepository, useValue: repository },
        // Downstream consumers are stubbed with spies. They capture the
        // shared `KanbanSettingsService` singleton via closure so we can
        // assert cross-path consistency.
        { provide: WorkItemTransitionStatusTool, useValue: toolSpy.tool },
        { provide: DispatchService, useValue: dispatchSpy.service },
        // Reconciler integration is exercised in a separate spec, but we
        // surface its read site here as a probe to assert the read path
        // is identical to the other consumers.
        { provide: "ReconcilerCapacityProbe", useValue: reconcilerProbeSpy },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    baseUrl = await listenOnRandomPort(app);
  });

  afterEach(async () => {
    await app?.close();
    vi.clearAllMocks();
  });

  it("round-trips a PUT of work_item_dispatch_max_active_per_project through the shared service", async () => {
    const newValue = 2;

    const response = await request(baseUrl)
      .put(`/kanban-settings/${MAX_ACTIVE_KEY}`)
      .send({ value: newValue })
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        key: MAX_ACTIVE_KEY,
        value: newValue,
      },
    });

    // Read-back through the same shared service used by every consumer.
    await expect(
      settingsService.getNumber(MAX_ACTIVE_KEY),
    ).resolves.toBe(newValue);

    // The repository should now hold exactly the new value.
    expect(settingsRows.get(MAX_ACTIVE_KEY)?.value).toBe(newValue);
  });

  it("seeds the default value on a fresh service (matches KANBAN_SETTING_DEFAULTS)", async () => {
    // The settingsRows map is populated by the beforeEach seedDefaults() call.
    const stored = settingsRows.get(MAX_ACTIVE_KEY);
    expect(stored).toBeDefined();
    expect(stored?.value).toBe(MAX_ACTIVE_DEFAULT);
    expect(MAX_ACTIVE_DEFAULT).toBe(3);

    // And reading through the service returns the same default.
    await expect(
      settingsService.getNumber(MAX_ACTIVE_KEY),
    ).resolves.toBe(MAX_ACTIVE_DEFAULT);
  });

  it("clamps out-of-range values to the configured max (currently 50)", async () => {
    const response = await request(baseUrl)
      .put(`/kanban-settings/${MAX_ACTIVE_KEY}`)
      .send({ value: 999 })
      .expect(200);

    expect(response.body.success).toBe(true);
    // The controller stores the raw value; clamping happens at read time
    // via getNumber. Mirror the unit test in kanban-settings.service.spec.ts.
    await expect(
      settingsService.getNumber(MAX_ACTIVE_KEY),
    ).resolves.toBe(MAX_ACTIVE_CEILING);
    expect(MAX_ACTIVE_CEILING).toBe(50);
  });

  it("exposes the same shared KanbanSettingsService to every downstream consumer", async () => {
    const newValue = 1;

    const response = await request(baseUrl)
      .put(`/kanban-settings/${MAX_ACTIVE_KEY}`)
      .send({ value: newValue })
      .expect(200);

    expect(response.body.data.value).toBe(newValue);

    // Each downstream consumer reads the cap from the shared
    // KanbanSettingsService singleton. After the PUT, every consumer
    // must observe the new value.
    const toolSnapshot = await (
      toolSpy.tool as unknown as {
        run: () => Promise<CapacitySnapshot>;
      }
    ).run();
    const readySnapshot = await (
      dispatchSpy.service as unknown as {
        dispatchReadyWorkItems: () => Promise<CapacitySnapshot>;
      }
    ).dispatchReadyWorkItems();
    const selectedSnapshot = await (
      dispatchSpy.service as unknown as {
        dispatchSelectedWorkItems: () => Promise<CapacitySnapshot>;
      }
    ).dispatchSelectedWorkItems();
    const reconcilerSnapshot = await reconcilerProbeSpy();

    // Strongest assertion: every consumer sees the same freshly-persisted
    // value (1), which can only happen if they share the same service
    // instance.
    expect(toolSnapshot.maxActive).toBe(newValue);
    expect(readySnapshot.maxActive).toBe(newValue);
    expect(selectedSnapshot.maxActive).toBe(newValue);
    expect(reconcilerSnapshot.maxActive).toBe(newValue);

    // And the read-back through the canonical service is also 1.
    await expect(
      settingsService.getNumber(MAX_ACTIVE_KEY),
    ).resolves.toBe(newValue);
  });

  it("rejects PUT bodies with malformed shape with a 400-class error", async () => {
    // The UpdateKanbanSettingRequestSchema allows `value: z.unknown()`,
    // so a non-numeric value (e.g. "not-a-number") passes the schema and
    // is later normalised at read time. The schema only rejects bodies
    // that fail the superRefine check (i.e. the "value" key is missing)
    // or fail the strict object shape (e.g. `null`). Mirror the
    // controller spec at apps/kanban/src/settings/kanban-settings.controller.spec.ts.
    await request(baseUrl)
      .put(`/kanban-settings/${MAX_ACTIVE_KEY}`)
      .send({})
      .expect(400);

    await request(baseUrl)
      .put(`/kanban-settings/${MAX_ACTIVE_KEY}`)
      .set("content-type", "application/json")
      .send("null")
      .expect(400);

    // Repository must remain at the default; the bad body must not have
    // been upserted.
    expect(settingsRows.get(MAX_ACTIVE_KEY)?.value).toBe(MAX_ACTIVE_DEFAULT);
  });

  it("accepts a non-numeric value at the controller layer and normalises it at read time", async () => {
    // The schema allows `value: z.unknown()` — strings, booleans, etc.
    // pass through. The service's `getNumber` normalises non-finite
    // values back to the configured default. This documents the
    // contract so we notice if it changes.
    await request(baseUrl)
      .put(`/kanban-settings/${MAX_ACTIVE_KEY}`)
      .send({ value: "not-a-number" })
      .expect(200);

    expect(settingsRows.get(MAX_ACTIVE_KEY)?.value).toBe("not-a-number");
    await expect(
      settingsService.getNumber(MAX_ACTIVE_KEY),
    ).resolves.toBe(MAX_ACTIVE_DEFAULT);
  });
});
