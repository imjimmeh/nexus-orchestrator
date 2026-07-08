import { describe, it, expect } from "vitest";
import {
  assertTelemetryVersion,
  KERNEL_TELEMETRY_VERSION,
} from "../../src/kernel.js";
import { PI_CAPABILITIES } from "@nexus/core";

describe("kernel engine guard", () => {
  it("accepts an engine whose telemetry version matches the kernel", () => {
    expect(() => {
      assertTelemetryVersion(PI_CAPABILITIES);
    }).not.toThrow();
  });
  it("throws on a telemetry-version mismatch", () => {
    expect(() => {
      assertTelemetryVersion({
        ...PI_CAPABILITIES,
        telemetryContractVersion: "v2" as never,
      });
    }).toThrow(/telemetry contract/i);
  });
});
