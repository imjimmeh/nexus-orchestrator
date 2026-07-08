import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  MESSAGE_KINDS,
  WarRoomMessageSection,
} from "./war-room-message-section";
import {
  PARTICIPANT_ROLES,
  WarRoomInviteSection,
} from "./war-room-invite-section";
import {
  RESOLUTION_TYPES,
  WarRoomCloseSection,
} from "./war-room-close-section";
import { WarRoomStateSummaryPanel } from "./war-room-state-summary-section";
import type { WarRoomStateSummary } from "./WarRoomSessionManagerPanel.hooks";

/**
 * Covers the four sub-sections extracted from
 * `war-room-selected-session-section.tsx` during the WarRoomSessionManager
 * split. Each section renders its own UI primitives and delegates the action
 * callbacks up to the composer, so the tests pin both the rendered output and
 * the callback wiring.
 */

function buildFoundState(): WarRoomStateSummary {
  return {
    status: "found",
    participants: [
      { agent_profile: "architect_a" },
      { agent_profile: "qa_b" },
      { agent_profile: "dev_c" },
    ],
    messages: [
      { body: "msg-1" },
      { body: "msg-2" },
      { body: "msg-3" },
      { body: "msg-4" },
    ],
  };
}

describe("WarRoomStateSummaryPanel", () => {
  it("renders the loading branch while the session state query is in-flight", () => {
    render(
      <WarRoomStateSummaryPanel
        isLoading
        errorMessage={null}
        state={undefined}
      />,
    );

    expect(screen.getByText("Loading session state...")).toBeTruthy();
  });

  it("renders the error branch when the session state query rejects", () => {
    render(
      <WarRoomStateSummaryPanel
        isLoading={false}
        errorMessage="something went wrong"
        state={undefined}
      />,
    );

    expect(screen.getByText("something went wrong")).toBeTruthy();
  });

  it("renders participant and message counts in the found branch", () => {
    const state = buildFoundState();

    render(
      <WarRoomStateSummaryPanel
        isLoading={false}
        errorMessage={null}
        state={state}
      />,
    );

    expect(
      screen.getByText("Participants: 3 · Messages: 4", { exact: false }),
    ).toBeTruthy();
  });

  it("renders the not-found branch using the denial_reason from the query", () => {
    render(
      <WarRoomStateSummaryPanel
        isLoading={false}
        errorMessage={null}
        state={{ status: "not_found", denial_reason: "not found" }}
      />,
    );

    expect(screen.getByText("not found")).toBeTruthy();
  });

  it("falls back to a generic notice when the state payload has no denial_reason", () => {
    render(
      <WarRoomStateSummaryPanel
        isLoading={false}
        errorMessage={null}
        state={{ status: "denied" }}
      />,
    );

    expect(screen.getByText("Session state unavailable.")).toBeTruthy();
  });
});

describe("WarRoomInviteSection", () => {
  it("renders every PARTICIPANT_ROLES entry inside the role select", () => {
    render(
      <WarRoomInviteSection
        actionPending={false}
        inviteAgentProfile=""
        inviteRole="architect"
        onInviteAgentProfileChange={vi.fn()}
        onInviteRoleChange={vi.fn()}
        onInvite={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("combobox"));
    const list = screen.getByRole("listbox");
    const listbox = within(list);

    for (const role of PARTICIPANT_ROLES) {
      expect(listbox.getByRole("option", { name: role })).toBeTruthy();
    }
    expect(PARTICIPANT_ROLES.length).toBeGreaterThan(0);
  });

  it("invokes onInvite once when the Invite Participant button is clicked", () => {
    const onInvite = vi.fn();

    render(
      <WarRoomInviteSection
        actionPending={false}
        inviteAgentProfile="qa_agent"
        inviteRole="qa"
        onInviteAgentProfileChange={vi.fn()}
        onInviteRoleChange={vi.fn()}
        onInvite={onInvite}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Invite Participant" }));

    expect(onInvite).toHaveBeenCalledTimes(1);
  });

  it("disables the Invite Participant button while actionPending is true", () => {
    render(
      <WarRoomInviteSection
        actionPending
        inviteAgentProfile=""
        inviteRole="architect"
        onInviteAgentProfileChange={vi.fn()}
        onInviteRoleChange={vi.fn()}
        onInvite={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Invite Participant" }),
    ).toBeDisabled();
  });
});

describe("WarRoomMessageSection", () => {
  it("renders every MESSAGE_KINDS entry inside the kind select", () => {
    render(
      <WarRoomMessageSection
        actionPending={false}
        messageKind="proposal"
        messageBody=""
        onMessageKindChange={vi.fn()}
        onMessageBodyChange={vi.fn()}
        onPostMessage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("combobox"));
    const listbox = within(screen.getByRole("listbox"));

    for (const kind of MESSAGE_KINDS) {
      expect(listbox.getByRole("option", { name: kind })).toBeTruthy();
    }
    expect(MESSAGE_KINDS.length).toBeGreaterThan(0);
  });

  it("invokes onPostMessage once when the Send Message button is clicked", () => {
    const onPostMessage = vi.fn();

    render(
      <WarRoomMessageSection
        actionPending={false}
        messageKind="proposal"
        messageBody="hello, war room"
        onMessageKindChange={vi.fn()}
        onMessageBodyChange={vi.fn()}
        onPostMessage={onPostMessage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send Message" }));

    expect(onPostMessage).toHaveBeenCalledTimes(1);
  });

  it("disables the Send Message button while actionPending is true", () => {
    render(
      <WarRoomMessageSection
        actionPending
        messageKind="proposal"
        messageBody=""
        onMessageKindChange={vi.fn()}
        onMessageBodyChange={vi.fn()}
        onPostMessage={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Send Message" })).toBeDisabled();
  });
});

describe("WarRoomCloseSection", () => {
  it("renders every RESOLUTION_TYPES entry inside the resolution select", () => {
    render(
      <WarRoomCloseSection
        actionPending={false}
        closeResolutionType="manual"
        closeNote=""
        onCloseResolutionTypeChange={vi.fn()}
        onCloseNoteChange={vi.fn()}
        onCloseSession={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("combobox"));
    const listbox = within(screen.getByRole("listbox"));

    for (const resolution of RESOLUTION_TYPES) {
      expect(listbox.getByRole("option", { name: resolution })).toBeTruthy();
    }
    expect(RESOLUTION_TYPES.length).toBeGreaterThan(0);
  });

  it("invokes onCloseSession once when the Close Session button is clicked", () => {
    const onCloseSession = vi.fn();

    render(
      <WarRoomCloseSection
        actionPending={false}
        closeResolutionType="consensus"
        closeNote="resolved by consensus"
        onCloseResolutionTypeChange={vi.fn()}
        onCloseNoteChange={vi.fn()}
        onCloseSession={onCloseSession}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close Session" }));

    expect(onCloseSession).toHaveBeenCalledTimes(1);
  });

  it("disables the Close Session button while actionPending is true", () => {
    render(
      <WarRoomCloseSection
        actionPending
        closeResolutionType="manual"
        closeNote=""
        onCloseResolutionTypeChange={vi.fn()}
        onCloseNoteChange={vi.fn()}
        onCloseSession={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Close Session" })).toBeDisabled();
  });
});
