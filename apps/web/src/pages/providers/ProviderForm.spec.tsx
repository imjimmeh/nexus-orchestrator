import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { LLMProvider } from "@/lib/api/providers.types";
import { Secret } from "@/lib/api/secrets.types";
import { ProviderForm } from "./ProviderForm";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const secrets: Secret[] = [
  {
    id: "sec-1",
    name: "Secret 1",
    metadata: {},
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
  {
    id: "sec-2",
    name: "Secret 2",
    metadata: {},
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  },
];

const provider: LLMProvider = {
  id: "prov-1",
  name: "OpenAI",
  auth_type: "api_key",
  secret_id: "sec-1",
  runtime_env: { base_url: "https://api.openai.com" },
  is_active: true,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  owner_type: null,
  owner_id: null,
  oauth_authorization_url: null,
  oauth_token_url: null,
  oauth_client_id: null,
  oauth_client_secret_id: null,
  oauth_scopes: null,
  oauth_redirect_uri: null,
};

const oauthProvider: LLMProvider = {
  ...provider,
  id: "prov-2",
  auth_type: "oauth",
  oauth_authorization_url: "https://auth.example.com/authorize",
  oauth_token_url: "https://auth.example.com/token",
  oauth_client_id: "client-123",
  oauth_client_secret_id: "sec-2",
  oauth_scopes: ["openid", "profile"],
  oauth_redirect_uri: "http://localhost/callback",
};

describe("ProviderForm", () => {
  describe("OAuth fields visibility", () => {
    it("shows OAuth registration fields when auth_type is oauth", () => {
      const onSubmit = vi.fn();
      render(
        <Wrapper>
          <ProviderForm
            provider={oauthProvider}
            secrets={secrets}
            onSubmit={onSubmit}
            onCancel={vi.fn()}
            isSubmitting={false}
          />
        </Wrapper>,
      );

      expect(screen.getByText(/oauth authorization/i)).toBeTruthy();
      expect(screen.getByText(/oauth token/i)).toBeTruthy();
      expect(screen.getByText(/oauth client id/i)).toBeTruthy();
    });

    it("hides OAuth registration fields when auth_type is api_key", () => {
      const onSubmit = vi.fn();
      render(
        <Wrapper>
          <ProviderForm
            provider={provider}
            secrets={secrets}
            onSubmit={onSubmit}
            onCancel={vi.fn()}
            isSubmitting={false}
          />
        </Wrapper>,
      );

      expect(screen.queryByText(/oauth authorization/i)).toBeNull();
      expect(screen.queryByText(/oauth token/i)).toBeNull();
    });
  });

  describe("owner fields", () => {
    it("renders owner_type and owner_id fields", () => {
      const onSubmit = vi.fn();
      render(
        <Wrapper>
          <ProviderForm
            provider={provider}
            secrets={secrets}
            onSubmit={onSubmit}
            onCancel={vi.fn()}
            isSubmitting={false}
          />
        </Wrapper>,
      );

      expect(screen.getByText(/owner type/i)).toBeTruthy();
      expect(screen.getByText(/owner id/i)).toBeTruthy();
    });
  });

  describe("OAuth explanatory copy", () => {
    it("shows explanatory copy when auth_type is oauth", async () => {
      const onSubmit = vi.fn();
      render(
        <Wrapper>
          <ProviderForm
            provider={oauthProvider}
            secrets={secrets}
            onSubmit={onSubmit}
            onCancel={vi.fn()}
            isSubmitting={false}
          />
        </Wrapper>,
      );

      const secretIdElements = screen.getAllByText(/oauth client secret id/i);
      expect(secretIdElements.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/oauth scopes/i)).toBeTruthy();
      expect(screen.getByText(/redirect uri/i)).toBeTruthy();
    });
  });

  describe("security: no raw token exposure", () => {
    it("does not render raw access_token or refresh_token fields", () => {
      const onSubmit = vi.fn();
      render(
        <Wrapper>
          <ProviderForm
            provider={oauthProvider}
            secrets={secrets}
            onSubmit={onSubmit}
            onCancel={vi.fn()}
            isSubmitting={false}
          />
        </Wrapper>,
      );

      expect(screen.queryByLabelText(/access.?token/i)).toBeNull();
      expect(screen.queryByLabelText(/refresh.?token/i)).toBeNull();
    });
  });

  describe("runtime env advanced section", () => {
    it("renders runtime env field", () => {
      const onSubmit = vi.fn();
      render(
        <Wrapper>
          <ProviderForm
            provider={provider}
            secrets={secrets}
            onSubmit={onSubmit}
            onCancel={vi.fn()}
            isSubmitting={false}
          />
        </Wrapper>,
      );

      expect(screen.getByText(/runtime/i)).toBeTruthy();
    });
  });

  describe("form submission", () => {
    it("calls onSubmit with form data", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(
        <Wrapper>
          <ProviderForm
            provider={{
              id: "",
              name: "Test Provider",
              auth_type: "api_key",
              runtime_env: {},
              is_active: true,
              created_at: "2026-01-01",
              updated_at: "2026-01-01",
              owner_type: null,
              owner_id: null,
              oauth_authorization_url: null,
              oauth_token_url: null,
              oauth_client_id: null,
              oauth_client_secret_id: null,
              oauth_scopes: null,
              oauth_redirect_uri: null,
            }}
            secrets={secrets}
            onSubmit={onSubmit}
            onCancel={vi.fn()}
            isSubmitting={false}
          />
        </Wrapper>,
      );

      const submitButton = screen.getByRole("button", { name: /update/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });
    });

    it("strips OAuth fields when auth_type is api_key", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(
        <Wrapper>
          <ProviderForm
            provider={oauthProvider}
            secrets={secrets}
            onSubmit={onSubmit}
            onCancel={vi.fn()}
            isSubmitting={false}
          />
        </Wrapper>,
      );

      const authSelect = screen.getByRole("combobox", { name: /auth type/i });
      await user.click(authSelect);

      const apiKeyOption = await screen.findByRole("option", {
        name: "API Key",
      });
      await user.click(apiKeyOption);

      const submitButton = screen.getByRole("button", { name: /update/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
        const submittedData = onSubmit.mock.calls[0][0];
        expect(submittedData.auth_type).toBe("api_key");
        expect(submittedData.oauth_authorization_url).toBeFalsy();
        expect(submittedData.oauth_token_url).toBeFalsy();
        expect(submittedData.oauth_client_id).toBeFalsy();
        expect(submittedData.oauth_client_secret_id).toBeFalsy();
        expect(submittedData.oauth_scopes).toBeFalsy();
        expect(submittedData.oauth_redirect_uri).toBeFalsy();
      });
    });

    it("preserves cancel button", () => {
      const onCancel = vi.fn();
      render(
        <Wrapper>
          <ProviderForm
            secrets={secrets}
            onSubmit={vi.fn()}
            onCancel={onCancel}
            isSubmitting={false}
          />
        </Wrapper>,
      );

      expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
    });
  });

  describe("edit-mode credential defaults", () => {
    it("defaults to 'existing' mode when the provider has a secret_id", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(
        <Wrapper>
          <ProviderForm
            provider={provider}
            secrets={secrets}
            onSubmit={onSubmit}
            onCancel={vi.fn()}
            isSubmitting={false}
          />
        </Wrapper>,
      );

      const submitButton = screen.getByRole("button", { name: /update/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
        const submitted = onSubmit.mock.calls[0][0] as {
          credential_mode: string;
        };
        expect(submitted.credential_mode).toBe("existing");
      });
    });

    it("defaults to 'create' mode when the provider has no secret_id", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      const providerWithoutSecret: LLMProvider = {
        ...provider,
        secret_id: null,
      };
      render(
        <Wrapper>
          <ProviderForm
            provider={providerWithoutSecret}
            secrets={secrets}
            onSubmit={onSubmit}
            onCancel={vi.fn()}
            isSubmitting={false}
          />
        </Wrapper>,
      );

      const submitButton = screen.getByRole("button", { name: /update/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
        const submitted = onSubmit.mock.calls[0][0] as {
          credential_mode: string;
        };
        expect(submitted.credential_mode).toBe("create");
      });
    });
  });
});
