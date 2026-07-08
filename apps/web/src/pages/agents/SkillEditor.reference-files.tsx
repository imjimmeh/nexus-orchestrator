import { useState } from "react";
import {
  useAgentSkillFiles,
  useDeleteAgentSkillFile,
  useUpsertAgentSkillFile,
} from "@/hooks/useAgentSkills";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface SkillFileEntry {
  path: string;
  sizeBytes: number;
  updatedAt: string;
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCodePoint(...chunk);
  }

  return globalThis.btoa(binary);
}

function SkillFilesList({
  isLoading,
  files,
  isDeleting,
  onDelete,
}: Readonly<{
  isLoading: boolean;
  files: SkillFileEntry[];
  isDeleting: boolean;
  onDelete: (path: string) => Promise<void>;
}>) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading files...</p>;
  }

  if (files.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No reference files yet.</p>
    );
  }

  return files.map((file) => (
    <div
      key={file.path}
      className="flex items-center justify-between rounded border px-3 py-2"
    >
      <div className="min-w-0">
        <p className="truncate font-mono text-xs">{file.path}</p>
        <p className="text-xs text-muted-foreground">{file.sizeBytes} bytes</p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isDeleting}
        onClick={async () => {
          await onDelete(file.path);
        }}
      >
        Delete
      </Button>
    </div>
  ));
}

export function SkillReferenceFilesSection(
  props: Readonly<{ skillId: string }>,
) {
  const skillId = props.skillId;
  const hasPersistedSkill = skillId.length > 0;
  const { data: files = [], isLoading: isLoadingFiles } =
    useAgentSkillFiles(skillId);
  const upsertSkillFile = useUpsertAgentSkillFile();
  const deleteSkillFile = useDeleteAgentSkillFile();

  const [newFilePath, setNewFilePath] = useState("");
  const [newFileContent, setNewFileContent] = useState("");
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(
    null,
  );
  const [uploadFilePath, setUploadFilePath] = useState("");
  const [isDragActive, setIsDragActive] = useState(false);
  const uploadInputId = "skill-reference-upload-input";

  const handleFileSelection = (file: File | null) => {
    setSelectedUploadFile(file);
    if (!file) {
      setUploadFilePath("");
      return;
    }

    setUploadFilePath(`references/${file.name}`);
  };

  if (!hasPersistedSkill) {
    return (
      <p className="text-sm text-muted-foreground">
        Save the skill first, then you can add reference files.
      </p>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Input
          placeholder="references/REFERENCE.md"
          value={newFilePath}
          onChange={(event) => setNewFilePath(event.target.value)}
        />
        <Button
          type="button"
          disabled={
            upsertSkillFile.isPending ||
            newFilePath.trim().length === 0 ||
            newFileContent.length === 0
          }
          onClick={async () => {
            await upsertSkillFile.mutateAsync({
              skillId,
              relativePath: newFilePath,
              content: newFileContent,
            });

            setNewFilePath("");
            setNewFileContent("");
          }}
        >
          {upsertSkillFile.isPending ? "Saving file..." : "Add File"}
        </Button>
      </div>

      <Textarea
        className="min-h-[120px] font-mono text-xs"
        placeholder="File content"
        value={newFileContent}
        onChange={(event) => setNewFileContent(event.target.value)}
      />

      <div className="space-y-3 rounded border p-3">
        <p className="text-sm font-medium">Upload File (Drag & Drop)</p>
        <label
          htmlFor={uploadInputId}
          className={
            isDragActive
              ? "rounded border-2 border-primary bg-primary/5 p-4"
              : "rounded border-2 border-dashed p-4"
          }
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setIsDragActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragActive(false);

            const droppedFile = event.dataTransfer.files[0] ?? null;
            handleFileSelection(droppedFile);
          }}
        >
          <p className="text-sm text-muted-foreground">
            Drag and drop one file here, or choose from disk.
          </p>
          <Input
            id={uploadInputId}
            className="mt-3"
            type="file"
            onChange={(event) => {
              const chosenFile = event.target.files?.[0] ?? null;
              handleFileSelection(chosenFile);
            }}
          />
        </label>

        <Input
          placeholder="references/image.png"
          value={uploadFilePath}
          onChange={(event) => setUploadFilePath(event.target.value)}
        />

        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-xs text-muted-foreground">
            {selectedUploadFile
              ? `Selected: ${selectedUploadFile.name} (${selectedUploadFile.size} bytes)`
              : "No file selected"}
          </p>
          <Button
            type="button"
            disabled={
              upsertSkillFile.isPending ||
              !selectedUploadFile ||
              uploadFilePath.trim().length === 0
            }
            onClick={async () => {
              if (!selectedUploadFile) {
                return;
              }

              const contentBase64 = await fileToBase64(selectedUploadFile);
              await upsertSkillFile.mutateAsync({
                skillId,
                relativePath: uploadFilePath,
                contentBase64,
              });

              setSelectedUploadFile(null);
              setUploadFilePath("");
            }}
          >
            {upsertSkillFile.isPending ? "Uploading..." : "Upload File"}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <SkillFilesList
          isLoading={isLoadingFiles}
          files={files}
          isDeleting={deleteSkillFile.isPending}
          onDelete={async (relativePath) => {
            await deleteSkillFile.mutateAsync({
              skillId,
              relativePath,
            });
          }}
        />
      </div>
    </>
  );
}
