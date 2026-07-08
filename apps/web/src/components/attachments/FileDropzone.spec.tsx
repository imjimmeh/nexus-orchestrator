import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { FileDropzone } from "./FileDropzone";
import * as useFileUploadModule from "@/hooks/useFileUpload";
import type { UseFileUploadReturn } from "@/hooks/useFileUpload";

vi.mock("@/hooks/useFileUpload");

function makeDefaultReturn(
  overrides: Partial<UseFileUploadReturn> = {},
): UseFileUploadReturn {
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

describe("FileDropzone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the drop zone with instructional text", () => {
    vi.spyOn(useFileUploadModule, "useFileUpload").mockReturnValue(
      makeDefaultReturn(),
    );

    render(<FileDropzone onUploaded={vi.fn()} />);

    expect(
      screen.getByText(/drag files here or click to browse/i),
    ).toBeTruthy();
  });

  it("shows an error message when the hook returns an error", () => {
    vi.spyOn(useFileUploadModule, "useFileUpload").mockReturnValue(
      makeDefaultReturn({ error: '"bad.bin" has an unsupported file type.' }),
    );

    render(<FileDropzone onUploaded={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /unsupported file type/i,
    );
  });

  it("does not show an error message when there is no error", () => {
    vi.spyOn(useFileUploadModule, "useFileUpload").mockReturnValue(
      makeDefaultReturn({ error: null }),
    );

    render(<FileDropzone onUploaded={vi.fn()} />);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("calls onUploaded with new IDs when uploads change", () => {
    const onUploaded = vi.fn();

    const hookReturn = makeDefaultReturn({
      uploads: [
        {
          id: "att-1",
          filename: "a.pdf",
          mimeType: "application/pdf",
          parseStatus: "pending",
        },
      ],
    });

    vi.spyOn(useFileUploadModule, "useFileUpload").mockReturnValue(hookReturn);

    render(<FileDropzone onUploaded={onUploaded} />);

    expect(onUploaded).toHaveBeenCalledWith(["att-1"]);
  });

  it("does not call onUploaded when there are no uploads", () => {
    const onUploaded = vi.fn();

    vi.spyOn(useFileUploadModule, "useFileUpload").mockReturnValue(
      makeDefaultReturn({ uploads: [] }),
    );

    render(<FileDropzone onUploaded={onUploaded} />);

    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("shows drag-active text when dragging over the drop zone", () => {
    vi.spyOn(useFileUploadModule, "useFileUpload").mockReturnValue(
      makeDefaultReturn(),
    );

    render(<FileDropzone onUploaded={vi.fn()} />);

    const dropzone = screen.getByRole("button", {
      name: /file upload drop zone/i,
    });
    fireEvent.dragOver(dropzone);

    expect(screen.getByText(/drop files here/i)).toBeTruthy();
  });

  it("calls addFiles on drop", () => {
    const addFiles = vi.fn();

    vi.spyOn(useFileUploadModule, "useFileUpload").mockReturnValue(
      makeDefaultReturn({ addFiles }),
    );

    render(<FileDropzone onUploaded={vi.fn()} />);

    const dropzone = screen.getByRole("button", {
      name: /file upload drop zone/i,
    });
    const file = new File(["content"], "test.pdf", { type: "application/pdf" });

    fireEvent.drop(dropzone, {
      dataTransfer: { files: [file] },
    });

    expect(addFiles).toHaveBeenCalled();
  });
});
