import { Injectable } from "@nestjs/common";
import type {
  ConflictCheckInput,
  ConflictResolutionResult,
} from "./conflict-resolver.types.js";

@Injectable()
export class ConflictResolverService {
  resolveExternalUpdate(input: ConflictCheckInput): ConflictResolutionResult {
    const externalTs = this.parseTimestamp(input.externalUpdatedAt);
    const workItemTs = this.parseTimestamp(input.workItemUpdatedAt);
    const sanitizedExternal =
      input.externalUpdatedAt != null && input.externalUpdatedAt !== ""
        ? input.externalUpdatedAt
        : null;

    const baseDetails = {
      externalUpdatedAt: sanitizedExternal,
      workItemUpdatedAt: input.workItemUpdatedAt,
      externalId: input.externalId,
      workItemId: input.workItemId,
    };

    if (externalTs === null) {
      return {
        decision: "skip_external",
        reason:
          "External updatedAt is missing or invalid, skipping to preserve local state",
        details: baseDetails,
      };
    }

    if (workItemTs === null) {
      return {
        decision: "skip_external",
        reason:
          "Work item updatedAt is invalid, skipping external update as a safety measure",
        details: baseDetails,
      };
    }

    if (externalTs > workItemTs) {
      return {
        decision: "apply_external",
        reason: `External (${sanitizedExternal}) is newer than work item (${input.workItemUpdatedAt})`,
        details: baseDetails,
      };
    }

    if (workItemTs > externalTs) {
      return {
        decision: "skip_external",
        reason: `Work item (${input.workItemUpdatedAt}) is newer than external (${sanitizedExternal})`,
        details: baseDetails,
      };
    }

    return {
      decision: "noop",
      reason: `Timestamps are equal (${sanitizedExternal}), no update needed`,
      details: baseDetails,
    };
  }

  private parseTimestamp(value: string | null | undefined): number | null {
    if (value == null || value === "") {
      return null;
    }
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) {
      return null;
    }
    return ms;
  }
}
