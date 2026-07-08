export interface UploadedFile {
  id: string;
  filename: string;
  mimeType: string;
  parseStatus: string;
}

export interface UseFileUploadReturn {
  uploads: UploadedFile[];
  uploading: boolean;
  addFiles: (files: FileList | File[]) => void;
  removeUpload: (id: string) => void;
  clear: () => void;
  error: string | null;
  progress: Record<string, number>;
}
