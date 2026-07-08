import { RuleTester } from "eslint";
import test from "node:test";
import { coreKanbanBoundaryRule } from "./core-kanban-boundary.mjs";

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
});

test("core kanban boundary rule", () => {
  tester.run("no-core-kanban-residue", coreKanbanBoundaryRule, {
    valid: [
      {
        filename: "G:/repo/apps/api/src/workflow/generic-trigger.ts",
        code: "export const payload = { scopeId: 'scope-1', contextId: 'resource-1' };",
      },
      {
        filename: "G:/repo/packages/core/src/schemas/events/event-envelope.schema.ts",
        code: "export const sourceService = z.string().min(1);",
      },
      {
        filename: "G:/repo/apps/kanban/src/work-item/work-item.service.ts",
        code: "export const event = 'kanban.work_item.status_changed.v1';",
      },
    ],
    invalid: [
      {
        filename: "G:/repo/apps/api/src/workflow/legacy.ts",
        code: "export const event = 'kanban.work_item.status_changed.v1';",
        errors: [{ messageId: "forbiddenResidue" }, { messageId: "forbiddenResidue" }],
      },
      {
        filename: "G:/repo/apps/api/src/workflow/legacy.ts",
        code: "export const trigger = { project_id: 'project-1', workItemId: 'item-1' };",
        errors: [{ messageId: "forbiddenResidue" }, { messageId: "forbiddenResidue" }],
      },
      {
        filename: "G:/repo/packages/core/src/errors/error-envelope.types.ts",
        code: "export const WorkItemStatusString = 'status';",
        errors: [{ messageId: "forbiddenResidue" }],
      },
    ],
  });
});
