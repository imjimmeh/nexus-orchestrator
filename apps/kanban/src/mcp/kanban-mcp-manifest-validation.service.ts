import { Injectable } from "@nestjs/common";
import type { IInternalToolHandler } from "@nexus/core";
import type {
  KanbanMcpManifestToolEntry,
  KanbanMcpManifestValidationResult,
} from "./kanban-mcp-manifest-validation.types";

@Injectable()
export class KanbanMcpManifestValidationService {
  validate(input: {
    readonly manifestTools: KanbanMcpManifestToolEntry[];
    readonly providers: IInternalToolHandler[];
  }): KanbanMcpManifestValidationResult {
    const manifestNames = new Set(input.manifestTools.map((tool) => tool.name));
    const providerNames = new Set(
      input.providers.map((provider) => provider.getName()),
    );

    return {
      missingProviders: [...manifestNames]
        .filter((name) => !providerNames.has(name))
        .sort((left, right) => left.localeCompare(right)),
      missingManifestEntries: [...providerNames]
        .filter((name) => !manifestNames.has(name))
        .sort((left, right) => left.localeCompare(right)),
    };
  }
}
