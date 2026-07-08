import type {
  CacheMountSpec,
  RuntimeToolchainConfig,
  ToolchainSpec,
} from "@nexus/core";
import { SUPPORTED_TOOLS } from "@nexus/core";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface RuntimeToolchainEditorProps {
  value: RuntimeToolchainConfig;
  onChange: (next: RuntimeToolchainConfig) => void;
}

export function RuntimeToolchainEditor({
  value,
  onChange,
}: Readonly<RuntimeToolchainEditorProps>) {
  const toolchains = value.toolchains ?? [];
  const caches = value.caches ?? [];

  function setToolchains(next: ToolchainSpec[]): void {
    onChange({ ...value, toolchains: next });
  }

  function setCaches(next: CacheMountSpec[]): void {
    onChange({ ...value, caches: next });
  }

  function addToolchain(): void {
    setToolchains([...toolchains, { tool: "node", version: "latest" }]);
  }

  function removeToolchain(index: number): void {
    setToolchains(toolchains.filter((_, i) => i !== index));
  }

  function patchToolchain(index: number, patch: Partial<ToolchainSpec>): void {
    setToolchains(
      toolchains.map((tc, i) => (i === index ? { ...tc, ...patch } : tc)),
    );
  }

  function addCache(): void {
    setCaches([...caches, { id: "", path: "" }]);
  }

  function removeCache(index: number): void {
    setCaches(caches.filter((_, i) => i !== index));
  }

  function patchCache(index: number, patch: Partial<CacheMountSpec>): void {
    setCaches(caches.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <p className="text-sm font-medium">Toolchains</p>
        {toolchains.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No toolchains configured.
          </p>
        ) : (
          toolchains.map((tc, index) => (
            <div
              key={`${tc.tool}::${index}`}
              className="flex items-center gap-2"
            >
              <Select
                value={tc.tool}
                onValueChange={(v) => patchToolchain(index, { tool: v })}
              >
                <SelectTrigger
                  className="w-40"
                  aria-label={`tool ${index + 1}`}
                >
                  <SelectValue placeholder="Tool" />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_TOOLS.map((tool) => (
                    <SelectItem key={tool} value={tool}>
                      {tool}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label={`version ${index + 1}`}
                className="w-32"
                value={tc.version}
                onChange={(e) =>
                  patchToolchain(index, { version: e.target.value })
                }
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`remove toolchain ${index + 1}`}
                onClick={() => removeToolchain(index)}
              >
                <Trash2 />
              </Button>
            </div>
          ))
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addToolchain}
        >
          Add toolchain
        </Button>
      </section>

      <section className="space-y-2">
        <p className="text-sm font-medium">Custom caches</p>
        {caches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No caches configured.</p>
        ) : (
          caches.map((cache, index) => (
            <div
              key={`${cache.id}::${index}`}
              className="flex items-center gap-2"
            >
              <Input
                aria-label={`cache id ${index + 1}`}
                className="w-32"
                value={cache.id}
                onChange={(e) => patchCache(index, { id: e.target.value })}
              />
              <Input
                aria-label={`cache path ${index + 1}`}
                className="w-48"
                value={cache.path}
                onChange={(e) => patchCache(index, { path: e.target.value })}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`remove cache ${index + 1}`}
                onClick={() => removeCache(index)}
              >
                <Trash2 />
              </Button>
            </div>
          ))
        )}
        <Button type="button" variant="outline" size="sm" onClick={addCache}>
          Add cache
        </Button>
      </section>
    </div>
  );
}
