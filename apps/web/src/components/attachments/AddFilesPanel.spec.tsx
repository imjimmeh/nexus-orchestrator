import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AttachmentDto } from "@nexus/core";
import { AddFilesPanel } from "./AddFilesPanel";
import * as clientAttachments from "@/lib/api/client.attachments";

// onFilesSelected callback captured from the rendered FileDropzone instance,
// allowing tests to trigger it directly without needing a real dropzone.
let capturedOnFilesSelected: ((files: File[]) => void) | null = null;

vi.mock("./FileDropzone", () => ({
  FileDropzone: ({
    onFilesSelected,
  }: {
    onFilesSelected?: (files: File[]) => void;
  }) => {
    capturedOnFilesSelected = onFilesSelected ?? null;
    return (
      <button
        type="button"
        data-testid="mock-dropzone"
        onClick={() => onFilesSelected?.([])}
      >
        Upload
      </button>
    );
  },
}));

vi.mock("@/hooks/useFileUpload", () => ({
  useFileUpload: vi.fn(),
}));

vi.mock("@/lib/api/client.attachments", () => ({
  getProjectAttachments: vi.fn(),
  linkAttachment: vi.fn(),
}));

import * as useFileUploadModule from "@/hooks/useFileUpload";

const mockUseFileUpload = vi.mocked(useFileUploadModule.useFileUpload);
const mockGetProjectAttachments = vi.mocked(
  clientAttachments.getProjectAttachments,
);
const mockLinkAttachment = vi.mocked(clientAttachments.linkAttachment);

const PDF_ATTACHMENT: AttachmentDto = {
  id: "att-pdf-1",
  filename: "spec.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1024,
  parseStatus: "parsed",
  parseError: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const IMAGE_ATTACHMENT: AttachmentDto = {
  id: "att-img-1",
  filename: "photo.png",
  mimeType: "image/png",
  sizeBytes: 2048,
  parseStatus: "parsed",
  parseError: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function makeUploadHookReturn(
  overrides: Partial<ReturnType<typeof useFileUploadModule.useFileUpload>> = {},
): ReturnType<typeof useFileUploadModule.useFileUpload> {
  return {
    uploads: [],
    uploading: false,
    addFiles: vi.fn(),
    removeUpload: vi.fn(),
    clear: vi.fn(),
    error: null,
    progress: {},
    ...overrides,
  };
}

async function settleInitialAttachmentLoad(projectId: string) {
  await waitFor(() => {
    expect(mockGetProjectAttachments).toHaveBeenCalledWith(projectId);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("AddFilesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnFilesSelected = null;
    mockGetProjectAttachments.mockResolvedValue([]);
    mockLinkAttachment.mockResolvedValue(undefined);
    mockUseFileUpload.mockReturnValue(makeUploadHookReturn());
  });

  it("renders without error", async () => {
    render(<AddFilesPanel projectId="proj-1" />);
    await settleInitialAttachmentLoad("proj-1");

    expect(screen.getByTestId("mock-dropzone")).toBeTruthy();
  });

  it("shows existing PDF attachments as chips", async () => {
    mockGetProjectAttachments.mockResolvedValue([PDF_ATTACHMENT]);

    render(<AddFilesPanel projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText("spec.pdf")).toBeTruthy();
    });

    expect(mockGetProjectAttachments).toHaveBeenCalledWith("proj-1");
  });

  it("shows existing image attachments as thumbnails", async () => {
    mockGetProjectAttachments.mockResolvedValue([IMAGE_ATTACHMENT]);

    render(<AddFilesPanel projectId="proj-1" />);

    await waitFor(() => {
      // ImageThumbnail renders an <img> with the filename as alt
      expect(screen.getByAltText("photo.png")).toBeTruthy();
    });
  });

  it("calls linkAttachment after a new upload succeeds", async () => {
    mockGetProjectAttachments.mockResolvedValue([]);

    // Start with uploading: true (in-flight)
    mockUseFileUpload.mockReturnValue(
      makeUploadHookReturn({ uploads: [], uploading: true }),
    );

    const { rerender } = render(<AddFilesPanel projectId="proj-abc" />);

    // Wait for the initial load to complete so linkedIdsRef is seeded
    await waitFor(() => {
      expect(mockGetProjectAttachments).toHaveBeenCalledWith("proj-abc");
    });

    // Simulate the upload completing (uploading: true → false)
    mockUseFileUpload.mockReturnValue(
      makeUploadHookReturn({
        uploads: [
          {
            id: "new-att-1",
            filename: "file.pdf",
            mimeType: "application/pdf",
            parseStatus: "pending",
          },
        ],
        uploading: false,
      }),
    );
    rerender(<AddFilesPanel projectId="proj-abc" />);

    await waitFor(() => {
      expect(mockLinkAttachment).toHaveBeenCalledWith(
        "new-att-1",
        "project",
        "proj-abc",
      );
    });
  });

  it("does not call linkAttachment for IDs already present in existing attachments", async () => {
    mockGetProjectAttachments.mockResolvedValue([PDF_ATTACHMENT]);

    // Start with uploading: true
    mockUseFileUpload.mockReturnValue(
      makeUploadHookReturn({ uploads: [], uploading: true }),
    );

    const { rerender } = render(<AddFilesPanel projectId="proj-1" />);

    // Wait for existing attachments to load (seeds linkedIdsRef with att-pdf-1)
    await waitFor(() => {
      expect(screen.getByText("spec.pdf")).toBeTruthy();
    });

    // Simulate upload completing with an ID that already exists (att-pdf-1)
    mockUseFileUpload.mockReturnValue(
      makeUploadHookReturn({
        uploads: [
          {
            id: PDF_ATTACHMENT.id,
            filename: "spec.pdf",
            mimeType: "application/pdf",
            parseStatus: "parsed",
          },
        ],
        uploading: false,
      }),
    );
    rerender(<AddFilesPanel projectId="proj-1" />);

    // Give any async work a chance to settle
    await waitFor(() => {
      // getProjectAttachments is called once on mount; no additional link calls
      expect(mockLinkAttachment).not.toHaveBeenCalled();
    });
  });

  it("shows an error message when loading attachments fails", async () => {
    mockGetProjectAttachments.mockRejectedValue(new Error("Network error"));

    render(<AddFilesPanel projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Network error");
    });
  });

  it("shows Project Files heading when attachments exist", async () => {
    mockGetProjectAttachments.mockResolvedValue([PDF_ATTACHMENT]);

    render(<AddFilesPanel projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText("Project Files")).toBeTruthy();
    });
  });

  it("does not show Project Files heading when no attachments exist", async () => {
    mockGetProjectAttachments.mockResolvedValue([]);

    render(<AddFilesPanel projectId="proj-1" />);

    // Wait for async load to complete
    await waitFor(() => {
      expect(mockGetProjectAttachments).toHaveBeenCalled();
    });

    expect(screen.queryByText("Project Files")).toBeNull();
  });

  it("passes addFiles to FileDropzone via onFilesSelected", async () => {
    const mockAddFiles = vi.fn();
    mockUseFileUpload.mockReturnValue(
      makeUploadHookReturn({ addFiles: mockAddFiles }),
    );

    render(<AddFilesPanel projectId="proj-1" />);
    await settleInitialAttachmentLoad("proj-1");

    const testFile = new File(["content"], "test.pdf", {
      type: "application/pdf",
    });
    capturedOnFilesSelected?.([testFile]);

    expect(mockAddFiles).toHaveBeenCalledWith([testFile]);
  });
});
