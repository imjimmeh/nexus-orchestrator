import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentProfileForm } from "./AgentProfileForm";

describe("AgentProfileForm", () => {
  it("shows provenance as read-only fields when editing a profile", async () => {
    render(
      <AgentProfileForm
        profile={{
          id: "profile-1",
          name: "spec-specialist",
          system_prompt: "You are a specialist.",
          model_name: "gpt-5.4",
          provider_name: "openai",
          tier_preference: "heavy",
          tool_policy: {
            default: "deny",
            rules: [{ effect: "allow", tool: "query_memory" }],
          },
          source: "agent_factory",
          created_by_profile: "ceo-agent",
          created_by_workflow_run_id: "run-1",
          factory_context: { reason: "spec decomposition" },
          is_active: true,
          created_at: "2026-04-05T00:00:00.000Z",
          updated_at: "2026-04-05T00:00:00.000Z",
        }}
        providers={[]}
        models={[]}
        tools={[]}
        skills={[]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isSubmitting={false}
      />,
    );

    const tab = screen.getByRole("tab", { name: "System & Provenance" });
    await userEvent.click(tab);

    expect(screen.getByText("Provenance")).toBeTruthy();
    expect(screen.getByDisplayValue("Agent Factory")).toBeTruthy();
    expect(screen.getByDisplayValue("ceo-agent")).toBeTruthy();
    expect(screen.getByDisplayValue("run-1")).toBeTruthy();
    expect(screen.getByDisplayValue(/spec decomposition/)).toBeTruthy();
  });

  it("does not show provenance section while creating a profile", () => {
    render(
      <AgentProfileForm
        providers={[]}
        models={[]}
        tools={[]}
        skills={[]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        isSubmitting={false}
      />,
    );

    expect(screen.queryByText("Provenance")).toBeNull();
  });

  describe("thinking level dropdown", () => {
    it("renders a Thinking Level dropdown with Inherit + all 6 levels", () => {
      render(
        <AgentProfileForm
          providers={[]}
          models={[]}
          tools={[]}
          skills={[]}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          isSubmitting={false}
        />,
      );

      expect(
        screen.getByRole("combobox", { name: /thinking level/i }),
      ).toBeTruthy();
    });

    it("submits thinking_level: 'low' when 'low' is selected", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();

      render(
        <AgentProfileForm
          providers={[]}
          models={[]}
          tools={[]}
          skills={[]}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
          isSubmitting={false}
        />,
      );

      // Fill in the required name field
      await user.type(screen.getByLabelText(/name/i), "test-profile");

      // Open and select "low" from the thinking level dropdown
      const thinkingLevelSelect = screen.getByRole("combobox", {
        name: /thinking level/i,
      });
      await user.click(thinkingLevelSelect);
      await user.click(screen.getByRole("option", { name: "low" }));

      // Submit the form
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ thinking_level: "low" }),
        expect.anything(),
      );
    });

    it("shows all 6 levels and Inherit option in the dropdown", async () => {
      const user = userEvent.setup();

      render(
        <AgentProfileForm
          providers={[]}
          models={[]}
          tools={[]}
          skills={[]}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          isSubmitting={false}
        />,
      );

      const thinkingLevelSelect = screen.getByRole("combobox", {
        name: /thinking level/i,
      });
      await user.click(thinkingLevelSelect);

      expect(screen.getByRole("option", { name: /inherit/i })).toBeTruthy();
      expect(screen.getByRole("option", { name: "off" })).toBeTruthy();
      expect(screen.getByRole("option", { name: "minimal" })).toBeTruthy();
      expect(screen.getByRole("option", { name: "low" })).toBeTruthy();
      expect(screen.getByRole("option", { name: "medium" })).toBeTruthy();
      expect(screen.getByRole("option", { name: "high" })).toBeTruthy();
      expect(screen.getByRole("option", { name: "xhigh" })).toBeTruthy();
    });

    it("pre-populates thinking_level from existing profile", () => {
      render(
        <AgentProfileForm
          profile={{
            id: "profile-1",
            name: "my-agent",
            is_active: true,
            thinking_level: "high",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          }}
          providers={[]}
          models={[]}
          tools={[]}
          skills={[]}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          isSubmitting={false}
        />,
      );

      const thinkingLevelTrigger = screen.getByRole("combobox", {
        name: /thinking level/i,
      });
      // The trigger should display the current value
      expect(thinkingLevelTrigger).toHaveTextContent("high");
    });
  });
});
