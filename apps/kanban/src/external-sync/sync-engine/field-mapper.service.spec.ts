import { describe, expect, it } from "vitest";
import { FieldMapperService } from "./field-mapper.service.js";

const KNOWN_KANBAN_STATUSES = [
  "backlog",
  "todo",
  "refinement",
  "in-progress",
  "in-review",
  "ready-to-merge",
  "blocked",
  "done",
];

const CONNECTION_ID = "660e8400-e29b-41d4-a716-446655440001";
const PROVIDER_TYPE = "jira";

describe("FieldMapperService", () => {
  const mapper = new FieldMapperService();

  describe("mapExternalTicketToWorkItemInput", () => {
    it("maps default fields from an external ticket using direct ticket fields", () => {
      const connection = {
        id: CONNECTION_ID,
        provider_type: PROVIDER_TYPE,
        field_mapping: {},
      };
      const ticket = {
        id: "EXT-123",
        title: "Fix login bug",
        description: "Users cannot log in",
        status: "in-progress",
        priority: "high",
        url: "https://jira.example.com/browse/EXT-123",
      };

      const result = mapper.mapExternalTicketToWorkItemInput(
        connection,
        ticket,
      );

      expect(result.title).toBe("Fix login bug");
      expect(result.description).toBe("Users cannot log in");
      expect(result.status).toBe("in-progress");
      expect(result.priority).toBe("high");
    });

    it("uses field_mapping to resolve custom field names from the external ticket", () => {
      const connection = {
        id: CONNECTION_ID,
        provider_type: PROVIDER_TYPE,
        field_mapping: {
          title: "summary",
          description: "details",
          status: "state",
          priority: "severity",
        },
      };
      const ticket = {
        id: "EXT-456",
        title: "ignored",
        summary: "Custom title",
        details: "Custom description",
        state: "refinement",
        severity: "critical",
      };

      const result = mapper.mapExternalTicketToWorkItemInput(
        connection,
        ticket,
      );

      expect(result.title).toBe("Custom title");
      expect(result.description).toBe("Custom description");
      expect(result.status).toBe("refinement");
      expect(result.priority).toBe("critical");
    });

    it("falls back to default field when custom mapped field is missing on the ticket", () => {
      const connection = {
        id: CONNECTION_ID,
        provider_type: PROVIDER_TYPE,
        field_mapping: {
          title: "summary",
        },
      };
      const ticket = {
        id: "EXT-789",
        title: "Default title",
        description: "Default desc",
        status: "todo",
      };

      const result = mapper.mapExternalTicketToWorkItemInput(
        connection,
        ticket,
      );

      expect(result.title).toBe("Default title");
      expect(result.description).toBe("Default desc");
      expect(result.status).toBe("todo");
    });

    it("falls back to 'todo' when external status is missing entirely", () => {
      const connection = {
        id: CONNECTION_ID,
        provider_type: PROVIDER_TYPE,
        field_mapping: {},
      };
      const ticket = {
        id: "EXT-000",
        title: "No status ticket",
      };

      const result = mapper.mapExternalTicketToWorkItemInput(
        connection,
        ticket,
      );

      expect(result.status).toBe("todo");
    });

    it("falls back to 'todo' when external status is not a known Kanban status", () => {
      const connection = {
        id: CONNECTION_ID,
        provider_type: PROVIDER_TYPE,
        field_mapping: {},
      };
      const ticket = {
        id: "EXT-001",
        title: "Weird status",
        status: "grooming",
      };

      const result = mapper.mapExternalTicketToWorkItemInput(
        connection,
        ticket,
      );

      expect(result.status).toBe("todo");
    });

    it("accepts every known Kanban status as-is from external ticket", () => {
      const connection = {
        id: CONNECTION_ID,
        provider_type: PROVIDER_TYPE,
        field_mapping: {},
      };

      for (const status of KNOWN_KANBAN_STATUSES) {
        const ticket = { id: "EXT-1", title: "Test", status };
        const result = mapper.mapExternalTicketToWorkItemInput(
          connection,
          ticket,
        );
        expect(result.status).toBe(status);
      }
    });

    it("includes metadata.external_sync with connection_id, external_id, provider_type, url, and timestamps", () => {
      const connection = {
        id: CONNECTION_ID,
        provider_type: PROVIDER_TYPE,
        field_mapping: {},
      };
      const ticket = {
        id: "EXT-900",
        title: "Metadata test",
        url: "https://linear.app/issue/LIN-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-06-01T12:00:00.000Z",
      };

      const result = mapper.mapExternalTicketToWorkItemInput(
        connection,
        ticket,
      );

      const sync = result.metadata.external_sync as Record<string, unknown>;
      expect(sync.connection_id).toBe(CONNECTION_ID);
      expect(sync.external_id).toBe("EXT-900");
      expect(sync.provider_type).toBe(PROVIDER_TYPE);
      expect(sync.url).toBe("https://linear.app/issue/LIN-1");
      expect(sync.sourceCreatedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(sync.sourceUpdatedAt).toBe("2026-06-01T12:00:00.000Z");
      expect(sync.synced_at).toBeDefined();
      expect(typeof sync.synced_at).toBe("string");
    });

    it("omits metadata.external_sync.url when ticket has no url", () => {
      const connection = {
        id: CONNECTION_ID,
        provider_type: PROVIDER_TYPE,
        field_mapping: {},
      };
      const ticket = {
        id: "EXT-NOURL",
        title: "No URL",
      };

      const result = mapper.mapExternalTicketToWorkItemInput(
        connection,
        ticket,
      );

      const sync = result.metadata.external_sync as Record<string, unknown>;
      expect(sync.url).toBeNull();
    });

    it("omits metadata.external_sync.sourceCreatedAt when ticket has no createdAt", () => {
      const connection = {
        id: CONNECTION_ID,
        provider_type: PROVIDER_TYPE,
        field_mapping: {},
      };
      const ticket = {
        id: "EXT-NODATES",
        title: "No dates",
      };

      const result = mapper.mapExternalTicketToWorkItemInput(
        connection,
        ticket,
      );

      const sync = result.metadata.external_sync as Record<string, unknown>;
      expect(sync.sourceCreatedAt).toBeNull();
      expect(sync.sourceUpdatedAt).toBeNull();
    });

    it("handles field_mapping that references nested paths in rawMetadata", () => {
      const connection = {
        id: CONNECTION_ID,
        provider_type: PROVIDER_TYPE,
        field_mapping: {
          title: "customFields.summary",
          description: "customFields.body",
          status: "workflowState",
        },
      };
      const ticket = {
        id: "EXT-NESTED",
        title: "Default",
        workflowState: "in-review",
        rawMetadata: {
          customFields: {
            summary: "From nested",
            body: "Nested description",
          },
        },
      };

      const result = mapper.mapExternalTicketToWorkItemInput(
        connection,
        ticket,
      );

      expect(result.title).toBe("From nested");
      expect(result.description).toBe("Nested description");
      expect(result.status).toBe("in-review");
      expect(result.priority).toBeNull();
    });

    it("falls back to default when field_mapping value is non-string (number)", () => {
      const connection = {
        id: CONNECTION_ID,
        provider_type: PROVIDER_TYPE,
        field_mapping: {
          title: 42,
        },
      };
      const ticket = {
        id: "EXT-NONSTR",
        title: "Default title",
        description: "Desc",
        status: "todo",
      };

      const result = mapper.mapExternalTicketToWorkItemInput(
        connection,
        ticket,
      );

      expect(result.title).toBe("Default title");
    });

    it("falls back to default when field_mapping value is non-string (object)", () => {
      const connection = {
        id: CONNECTION_ID,
        provider_type: PROVIDER_TYPE,
        field_mapping: {
          title: { path: "nested" },
        },
      };
      const ticket = {
        id: "EXT-NONSTR2",
        title: "Default title",
      };

      const result = mapper.mapExternalTicketToWorkItemInput(
        connection,
        ticket,
      );

      expect(result.title).toBe("Default title");
    });

    it("handles field_mapping as null/undefined safely", () => {
      const connection = {
        id: CONNECTION_ID,
        provider_type: PROVIDER_TYPE,
        field_mapping: null as unknown as Record<string, unknown>,
      };
      const ticket = {
        id: "EXT-NULLMAP",
        title: "Null mapping title",
        status: "backlog",
      };

      const result = mapper.mapExternalTicketToWorkItemInput(
        connection,
        ticket,
      );

      expect(result.title).toBe("Null mapping title");
      expect(result.status).toBe("backlog");
    });

    it("handles rawMetadata that is not an object (string) safely", () => {
      const connection = {
        id: CONNECTION_ID,
        provider_type: PROVIDER_TYPE,
        field_mapping: {
          title: "customField",
        },
      };
      const ticket = {
        id: "EXT-BADMETA",
        title: "Default",
        rawMetadata: "not-an-object" as unknown as Record<string, unknown>,
      };

      const result = mapper.mapExternalTicketToWorkItemInput(
        connection,
        ticket,
      );

      expect(result.title).toBe("Default");
    });

    it("does not resolve prototype keys from field_mapping paths", () => {
      const connection = {
        id: CONNECTION_ID,
        provider_type: PROVIDER_TYPE,
        field_mapping: {
          title: "__proto__",
          description: "constructor",
        },
      };
      const ticket = {
        id: "EXT-PROTO",
        title: "Safe title",
        description: "Safe description",
      };

      const result = mapper.mapExternalTicketToWorkItemInput(
        connection,
        ticket,
      );

      expect(result.title).toBe("Safe title");
      expect(result.description).toBe("Safe description");
    });

    it("does not resolve toString/__proto__ nested keys", () => {
      const connection = {
        id: CONNECTION_ID,
        provider_type: PROVIDER_TYPE,
        field_mapping: {
          title: "rawMetadata.__proto__.evil",
          status: "toString",
        },
      };
      const ticket = {
        id: "EXT-PROTO2",
        title: "Safe",
        status: "in-progress",
        rawMetadata: {
          __proto__: { evil: "hacked" },
        } as unknown as Record<string, unknown>,
      };

      const result = mapper.mapExternalTicketToWorkItemInput(
        connection,
        ticket,
      );

      expect(result.title).toBe("Safe");
      expect(result.status).toBe("in-progress");
    });

    it("passes undefined through validateStatus gracefully", () => {
      const connection = {
        id: CONNECTION_ID,
        provider_type: PROVIDER_TYPE,
        field_mapping: {},
      };
      const ticket = {
        id: "EXT-UNDEF",
        title: "Undefined status",
        status: undefined,
      };

      const result = mapper.mapExternalTicketToWorkItemInput(
        connection,
        ticket,
      );

      expect(result.status).toBe("todo");
    });
  });

  describe("mapWorkItemToExternalTicket", () => {
    it("maps work item fields to an ExternalTicket create/patch shape with default field names", () => {
      const workItem = {
        title: "Build auth module",
        description: "Implement JWT authentication",
        status: "in-progress",
        priority: "high",
      };

      const result = mapper.mapWorkItemToExternalTicket(workItem);

      expect(result.title).toBe("Build auth module");
      expect(result.description).toBe("Implement JWT authentication");
      expect(result.status).toBe("in-progress");
      expect(result.priority).toBe("high");
    });

    it("uses field_mapping to remap outbound field names", () => {
      const workItem = {
        title: "Outbound test",
        status: "done",
      };
      const fieldMapping = {
        title: "name",
        status: "state",
      };

      const result = mapper.mapWorkItemToExternalTicket(workItem, fieldMapping);

      expect(result.name).toBe("Outbound test");
      expect(result.state).toBe("done");
      expect(result.title).toBeUndefined();
      expect(result.status).toBeUndefined();
    });

    it("omits undefined work item fields from the result", () => {
      const workItem = {
        title: "Minimal",
      };

      const result = mapper.mapWorkItemToExternalTicket(workItem);

      expect(result.title).toBe("Minimal");
      expect(result.description).toBeUndefined();
      expect(result.status).toBeUndefined();
      expect(result.priority).toBeUndefined();
    });

    it("applies partial field_mapping alongside unmapped defaults", () => {
      const workItem = {
        title: "Partial map",
        description: "Some desc",
        status: "todo",
        priority: "low",
      };
      const fieldMapping = {
        title: "subject",
      };

      const result = mapper.mapWorkItemToExternalTicket(workItem, fieldMapping);

      expect(result.subject).toBe("Partial map");
      expect(result.title).toBeUndefined();
      expect(result.description).toBe("Some desc");
      expect(result.status).toBe("todo");
      expect(result.priority).toBe("low");
    });

    it("omits empty string fields from outbound result", () => {
      const workItem = {
        title: "",
        description: "Still here",
        status: "",
        priority: "high",
      };

      const result = mapper.mapWorkItemToExternalTicket(workItem);

      expect(result.title).toBeUndefined();
      expect(result.description).toBe("Still here");
      expect(result.status).toBeUndefined();
      expect(result.priority).toBe("high");
    });

    it("omits empty string fields when using field_mapping remap", () => {
      const workItem = {
        title: "",
        status: "done",
      };
      const fieldMapping = {
        title: "subject",
        status: "state",
      };

      const result = mapper.mapWorkItemToExternalTicket(workItem, fieldMapping);

      expect(result.subject).toBeUndefined();
      expect(result.title).toBeUndefined();
      expect(result.state).toBe("done");
    });
  });
});
