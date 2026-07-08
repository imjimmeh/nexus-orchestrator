import { describe, expect, it } from "vitest";
import {
  resolveRepositoryIntegrationSettings,
  resolveRepositoryWorkflowSettings,
} from "./repository-workflow-settings";
import type {
  RepositoryIntegrationStrategy,
  RepositoryMergeMethod,
} from "./repository-workflow-settings.types";

describe("resolveRepositoryWorkflowSettings", () => {
  it("defaults to enabled when settings are null", () => {
    expect(resolveRepositoryWorkflowSettings(null)).toEqual({
      enabled: true,
      overrides: {},
    });
  });

  it("defaults to enabled when settings are undefined", () => {
    expect(resolveRepositoryWorkflowSettings(undefined)).toEqual({
      enabled: true,
      overrides: {},
    });
  });

  it("defaults enabled to true when the enabled flag is missing", () => {
    expect(resolveRepositoryWorkflowSettings({ overrides: {} })).toEqual({
      enabled: true,
      overrides: {},
    });
  });

  it("honors an explicit disabled flag", () => {
    expect(resolveRepositoryWorkflowSettings({ enabled: false })).toEqual({
      enabled: false,
      overrides: {},
    });
  });

  it("preserves valid per-workflow overrides and drops malformed ones", () => {
    const resolved = resolveRepositoryWorkflowSettings({
      enabled: true,
      overrides: {
        wf1: { enabled: false },
        wf2: { enabled: "nope" },
        wf3: "bad",
      },
    });

    expect(resolved.overrides).toEqual({ wf1: { enabled: false } });
  });
});

describe("resolveRepositoryIntegrationSettings", () => {
  it("defaults to direct-push when absent", () => {
    expect(resolveRepositoryIntegrationSettings(null)).toEqual({
      strategy: "direct-push",
      mergeMethod: "merge",
      autoMerge: false,
      preflightGate: true,
    });
  });

  it("defaults when the integration sub-object is missing", () => {
    expect(
      resolveRepositoryIntegrationSettings({ enabled: true, overrides: {} }),
    ).toEqual({
      strategy: "direct-push",
      mergeMethod: "merge",
      autoMerge: false,
      preflightGate: true,
    });
  });

  it("passes through persisted values", () => {
    expect(
      resolveRepositoryIntegrationSettings({
        enabled: true,
        overrides: {},
        integration: {
          strategy: "pull-request",
          mergeMethod: "squash",
          autoMerge: true,
          preflightGate: false,
        },
      }),
    ).toEqual({
      strategy: "pull-request",
      mergeMethod: "squash",
      autoMerge: true,
      preflightGate: false,
    });
  });

  it("coerces malformed persisted values back to defaults without throwing", () => {
    expect(
      resolveRepositoryIntegrationSettings({
        enabled: true,
        overrides: {},
        integration: {
          strategy: "nonsense",
          mergeMethod: 7,
          autoMerge: "yes",
          preflightGate: null,
        },
      }),
    ).toEqual({
      strategy: "direct-push",
      mergeMethod: "merge",
      autoMerge: false,
      preflightGate: true,
    });
  });

  it("pins the literal sets matching spec 10.1", () => {
    const strategies: RepositoryIntegrationStrategy[] = [
      "direct-push",
      "pull-request",
    ];
    const methods: RepositoryMergeMethod[] = ["merge", "squash", "rebase"];
    expect(strategies).toEqual(["direct-push", "pull-request"]);
    expect(methods).toEqual(["merge", "squash", "rebase"]);
  });

  it("resolveRepositoryWorkflowSettings forwards a persisted integration sub-object", () => {
    const resolved = resolveRepositoryWorkflowSettings({
      enabled: true,
      overrides: {},
      integration: {
        strategy: "pull-request",
        mergeMethod: "rebase",
        autoMerge: true,
        preflightGate: false,
      },
    });
    expect(resolved.integration).toEqual({
      strategy: "pull-request",
      mergeMethod: "rebase",
      autoMerge: true,
      preflightGate: false,
    });
  });

  it("resolveRepositoryWorkflowSettings omits integration when absent", () => {
    const resolved = resolveRepositoryWorkflowSettings({
      enabled: true,
      overrides: {},
    });
    expect(resolved.integration).toBeUndefined();
  });
});
