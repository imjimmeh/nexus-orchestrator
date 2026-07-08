import type {
  AttachmentDto,
  AttachmentOwnerType,
  UploadAttachmentResponse,
} from "@nexus/core";
import { api } from "./client";
import { getAccessToken } from "./client.auth";

const ATTACHMENTS_BASE = "/attachments";

export async function uploadAttachment(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<UploadAttachmentResponse> {
  return new Promise<UploadAttachmentResponse>((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();

    if (onProgress) {
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText) as {
            data: UploadAttachmentResponse;
          };
          resolve(parsed.data);
        } catch {
          reject(new Error("Failed to parse upload response"));
        }
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during upload"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload aborted"));
    });

    // Resolve the base URL the same way the axios client does — default to /api
    const baseUrl =
      typeof window !== "undefined"
        ? ((window as Window & { __RUNTIME_CONFIG__?: { apiUrl?: string } })
            .__RUNTIME_CONFIG__?.apiUrl ?? "/api")
        : "/api";

    xhr.open("POST", `${baseUrl}${ATTACHMENTS_BASE}`);

    const token = getAccessToken();
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    xhr.send(formData);
  });
}

export async function getAttachmentMetadata(
  id: string,
): Promise<AttachmentDto> {
  return api.get<AttachmentDto>(
    `${ATTACHMENTS_BASE}/${encodeURIComponent(id)}`,
  );
}

export async function getAttachmentParsed(
  id: string,
): Promise<{ status: string; content: string | null }> {
  return api.get<{ status: string; content: string | null }>(
    `${ATTACHMENTS_BASE}/${encodeURIComponent(id)}/parsed`,
  );
}

export async function linkAttachment(
  attachmentId: string,
  ownerType: AttachmentOwnerType,
  ownerId: string,
): Promise<void> {
  await api.post<null>(
    `${ATTACHMENTS_BASE}/${encodeURIComponent(attachmentId)}/link`,
    { ownerType, ownerId },
  );
}

export async function getProjectAttachments(
  projectId: string,
): Promise<AttachmentDto[]> {
  return api.get<AttachmentDto[]>(ATTACHMENTS_BASE, {
    params: { ownerType: "project", ownerId: projectId },
  });
}
