import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTACHMENT_MAX_SIZE_BYTES,
  ATTACHMENT_MIME_ALLOWLIST,
} from "@nexus/core";
import type { UploadAttachmentResponse } from "@nexus/core";
import { uploadAttachment } from "@/lib/api/client.attachments";
import { useFileUpload } from "./useFileUpload";

vi.mock("@/lib/api/client.attachments", () => ({
  uploadAttachment: vi.fn(),
}));

function makeFile(name: string, type: string, size: number): File {
  const blob = new Blob([new ArrayBuffer(size)], { type });
  return new File([blob], name, { type });
}

const VALID_MIME = ATTACHMENT_MIME_ALLOWLIST[0];
const INVALID_MIME = "application/x-unknown-type";

describe("useFileUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets error and does not upload when MIME type is not allowed", async () => {
    const { result } = renderHook(() => useFileUpload());

    act(() => {
      result.current.addFiles([makeFile("test.bin", INVALID_MIME, 100)]);
    });

    expect(result.current.error).toMatch(/unsupported file type/i);
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(result.current.uploads).toHaveLength(0);
  });

  it("sets error and does not upload when file exceeds the size limit", async () => {
    const { result } = renderHook(() => useFileUpload());
    const oversizedFile = makeFile(
      "big.pdf",
      VALID_MIME,
      ATTACHMENT_MAX_SIZE_BYTES + 1,
    );

    act(() => {
      result.current.addFiles([oversizedFile]);
    });

    expect(result.current.error).toMatch(/size limit/i);
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(result.current.uploads).toHaveLength(0);
  });

  it("calls uploadAttachment and appends to uploads on success", async () => {
    vi.mocked(uploadAttachment).mockResolvedValue({
      id: "att-123",
      filename: "document.pdf",
      mimeType: VALID_MIME,
      sizeBytes: 512,
      parseStatus: "pending",
    });

    const { result } = renderHook(() => useFileUpload());
    const validFile = makeFile("document.pdf", VALID_MIME, 512);

    act(() => {
      result.current.addFiles([validFile]);
    });

    await waitFor(() => {
      expect(result.current.uploads).toHaveLength(1);
    });

    expect(result.current.uploads[0]).toEqual({
      id: "att-123",
      filename: "document.pdf",
      mimeType: VALID_MIME,
      parseStatus: "pending",
    });
    expect(result.current.error).toBeNull();
    expect(result.current.uploading).toBe(false);
  });

  it("sets error when uploadAttachment rejects", async () => {
    vi.mocked(uploadAttachment).mockRejectedValue(new Error("Network failure"));

    const { result } = renderHook(() => useFileUpload());

    act(() => {
      result.current.addFiles([makeFile("doc.pdf", VALID_MIME, 100)]);
    });

    await waitFor(() => {
      expect(result.current.error).toBe("Network failure");
    });

    expect(result.current.uploading).toBe(false);
  });

  it("removeUpload removes the entry by id", async () => {
    vi.mocked(uploadAttachment).mockResolvedValue({
      id: "att-999",
      filename: "sample.pdf",
      mimeType: VALID_MIME,
      sizeBytes: 256,
      parseStatus: "pending",
    });

    const { result } = renderHook(() => useFileUpload());

    act(() => {
      result.current.addFiles([makeFile("sample.pdf", VALID_MIME, 256)]);
    });

    await waitFor(() => expect(result.current.uploads).toHaveLength(1));

    act(() => {
      result.current.removeUpload("att-999");
    });

    expect(result.current.uploads).toHaveLength(0);
  });

  it("clear resets uploads and error", async () => {
    const { result } = renderHook(() => useFileUpload());

    act(() => {
      result.current.addFiles([makeFile("bad.bin", INVALID_MIME, 10)]);
    });

    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.clear();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.uploads).toHaveLength(0);
  });

  it("sets uploading to true while a file is in-flight", async () => {
    const validFile = makeFile("document.pdf", VALID_MIME, 512);
    let resolveUpload!: (val: UploadAttachmentResponse) => void;
    const deferred = new Promise<UploadAttachmentResponse>((resolve) => {
      resolveUpload = resolve;
    });
    vi.mocked(uploadAttachment).mockReturnValue(deferred);

    const { result } = renderHook(() => useFileUpload());
    act(() => result.current.addFiles([validFile]));

    expect(result.current.uploading).toBe(true);

    await act(async () => {
      resolveUpload({
        id: "att-456",
        filename: "document.pdf",
        mimeType: VALID_MIME,
        sizeBytes: 512,
        parseStatus: "pending",
      });
    });

    expect(result.current.uploading).toBe(false);
  });
});
