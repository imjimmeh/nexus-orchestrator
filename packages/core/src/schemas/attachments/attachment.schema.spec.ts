import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MAX_SIZE_BYTES,
  ATTACHMENT_MIME_ALLOWLIST,
  attachmentDtoSchema,
  isAllowedAttachmentMime,
  uploadAttachmentResponseSchema,
} from "./attachment.schema";

describe("attachment contracts", () => {
  it("allows pdf and png, rejects executables", () => {
    expect(isAllowedAttachmentMime("application/pdf")).toBe(true);
    expect(isAllowedAttachmentMime("image/png")).toBe(true);
    expect(isAllowedAttachmentMime("application/x-msdownload")).toBe(false);
  });

  it("caps size at 25MB by default", () => {
    expect(ATTACHMENT_MAX_SIZE_BYTES).toBe(25 * 1024 * 1024);
    expect(ATTACHMENT_MIME_ALLOWLIST.length).toBeGreaterThan(0);
  });

  it("validates an upload response", () => {
    const parsed = uploadAttachmentResponseSchema.parse({
      id: "11111111-1111-1111-8111-111111111111",
      filename: "spec.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1234,
      parseStatus: "pending",
    });
    expect(parsed.parseStatus).toBe("pending");
  });
});

describe("attachmentDtoSchema", () => {
  it("accepts a full dto with parseError and createdAt", () => {
    const parsed = attachmentDtoSchema.parse({
      id: "11111111-1111-1111-8111-111111111111",
      filename: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      parseStatus: "parsed",
      parseError: null,
      createdAt: "2026-06-10T00:00:00.000Z",
    });
    expect(parsed.parseError).toBeNull();
    expect(parsed.createdAt).toBe("2026-06-10T00:00:00.000Z");
  });

  it("allows parseError to be undefined (optional)", () => {
    const parsed = attachmentDtoSchema.parse({
      id: "11111111-1111-1111-8111-111111111111",
      filename: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      parseStatus: "failed",
      createdAt: "2026-06-10T00:00:00.000Z",
    });
    expect(parsed.parseError).toBeUndefined();
  });

  it("allows parseError to be a string", () => {
    const parsed = attachmentDtoSchema.parse({
      id: "11111111-1111-1111-8111-111111111111",
      filename: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      parseStatus: "failed",
      parseError: "corrupt file",
      createdAt: "2026-06-10T00:00:00.000Z",
    });
    expect(parsed.parseError).toBe("corrupt file");
  });
});
