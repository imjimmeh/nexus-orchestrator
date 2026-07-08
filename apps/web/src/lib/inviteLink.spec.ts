import { afterEach, describe, expect, it, vi } from "vitest";
import { buildInviteLink } from "./inviteLink";

describe("buildInviteLink", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses VITE_PUBLIC_APP_URL when set, trimming a trailing slash", () => {
    vi.stubEnv("VITE_PUBLIC_APP_URL", "https://app.example.com/");

    expect(buildInviteLink("abc")).toBe(
      "https://app.example.com/accept-invite?token=abc",
    );
  });

  it("falls back to window.location.origin when VITE_PUBLIC_APP_URL is unset", () => {
    vi.stubEnv("VITE_PUBLIC_APP_URL", "");

    expect(buildInviteLink("abc")).toBe(
      `${window.location.origin}/accept-invite?token=abc`,
    );
  });

  it("URL-encodes the token", () => {
    vi.stubEnv("VITE_PUBLIC_APP_URL", "https://app.example.com");

    expect(buildInviteLink("a b/c+d")).toBe(
      "https://app.example.com/accept-invite?token=a%20b%2Fc%2Bd",
    );
  });
});
