import { describe, expect, it } from "vitest";
import { patchInboxReadState } from "@/lib/notifications/inboxCache";
import type { InboxEnvelope } from "@/lib/notifications/inboxCache.types";

const buildEnvelope = (): InboxEnvelope => ({
  success: true,
  data: [
    {
      id: "1",
      subject: "First",
      body: "First body",
      eventType: "workflow.run.failed",
      createdAt: "2024-01-01T00:00:00Z",
      readAt: null,
      metadata: null,
    },
    {
      id: "2",
      subject: "Second",
      body: "Second body",
      eventType: "workflow.run.failed",
      createdAt: "2024-01-02T00:00:00Z",
      readAt: null,
      metadata: null,
    },
  ],
  meta: { total: 2 },
});

describe("patchInboxReadState", () => {
  it("returns undefined unchanged when current is undefined", () => {
    const result = patchInboxReadState(
      undefined,
      "1",
      "2024-01-01T00:00:00Z",
    );

    expect(result).toBeUndefined();
  });

  it("returns the original current reference when data is missing", () => {
    const current = { success: true };

    const result = patchInboxReadState(
      current,
      "1",
      "2024-01-01T00:00:00Z",
    );

    expect(result).toBe(current);
  });

  it("returns a new envelope with an empty data array when data is empty", () => {
    // Note: an empty array is truthy in JavaScript, so the original
    // helper proceeds past the early-return guard and produces a new
    // envelope with an empty `data` array.
    const current: InboxEnvelope = { success: true, data: [] };

    const result = patchInboxReadState(
      current,
      "1",
      "2024-01-01T00:00:00Z",
    );

    expect(result).not.toBe(current);
    const updated = result as NonNullable<InboxEnvelope>;
    expect(updated.data).toEqual([]);
    expect(updated.success).toBe(true);
  });

  it("updates the matching notification readAt immutably and leaves others unchanged", () => {
    const current = buildEnvelope();
    if (!current) throw new Error("fixture must be defined");

    const result = patchInboxReadState(
      current,
      "1",
      "2024-02-01T00:00:00Z",
    );

    expect(result).not.toBe(current);
    const updated = result as NonNullable<InboxEnvelope>;
    expect(updated.data).not.toBe(current.data);
    expect(updated.data).toHaveLength(2);
    expect(updated.data[0]).toEqual({
      id: "1",
      subject: "First",
      body: "First body",
      eventType: "workflow.run.failed",
      createdAt: "2024-01-01T00:00:00Z",
      readAt: "2024-02-01T00:00:00Z",
      metadata: null,
    });
    expect(updated.data[0]).not.toBe(current.data[0]);
    expect(updated.data[1]).toBe(current.data[1]);
    expect(updated.meta).toEqual(current.meta);
  });

  it("returns a new envelope whose data array is unchanged when notificationId does not match", () => {
    const current = buildEnvelope();
    if (!current) throw new Error("fixture must be defined");

    const result = patchInboxReadState(
      current,
      "missing-id",
      "2024-02-01T00:00:00Z",
    );

    expect(result).not.toBe(current);
    const updated = result as NonNullable<InboxEnvelope>;
    expect(updated.data).not.toBe(current.data);
    expect(updated.data).toHaveLength(2);
    expect(updated.data[0]).toBe(current.data[0]);
    expect(updated.data[1]).toBe(current.data[1]);
    expect(updated.meta).toEqual(current.meta);
  });
});