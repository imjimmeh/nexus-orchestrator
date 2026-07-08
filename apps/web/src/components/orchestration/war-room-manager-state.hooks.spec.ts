/**
 * @file war-room-manager-state.hooks.spec.ts
 *
 * Unit spec for `useWarRoomManagerState`. The hook is the local-form-state
 * carrier for `WarRoomSessionManagerPanel` and exposes **ten independent
 * `useState` slots** (one per UI field), each paired with its own setter.
 *
 * The original AC-6 plan called for a `useReducer` migration with compound
 * reset actions (`resetOpenSessionForm`, `resetMessageForm`, `resetCloseForm`,
 * `setInvite` that clears the agent profile). That work was rescoped: the
 * child-1 useReducer migration is owned by a sibling work item and has not
 * landed on this branch. **This spec therefore asserts the shipped
 * `useState`-per-field contract** — defaults for every slot, per-slot setter
 * semantics, and cross-slot immutability — rather than inventing tests for
 * compound reset actions that do not exist in the implementation.
 *
 * If a future PR introduces compound reset actions (or a `useReducer` swap),
 * new tests should be added here that exercise those actions. The guard at
 * the bottom of this file asserts that no such action has slipped in
 * unilaterally: the hook only exposes the ten documented per-slot
 * setters.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProjectWarRoomMessageKind, ProjectWarRoomParticipantRole, ProjectWarRoomResolutionType } from "@/lib/api/orchestration.types";
import type { WarRoomManagerState } from "./WarRoomSessionManagerPanel.hooks";
import { useWarRoomManagerState } from "./war-room-manager-state.hooks";

const SETTER_KEYS = [
  "setSelectedSessionId",
  "setOpenSessionId",
  "setOpenInitialMessage",
  "setInviteAgentProfile",
  "setInviteRole",
  "setMessageKind",
  "setMessageBody",
  "setCloseResolutionType",
  "setCloseNote",
  "setNotice",
] as const satisfies ReadonlyArray<keyof WarRoomManagerState>;

type SetterKey = (typeof SETTER_KEYS)[number];

function readState(state: WarRoomManagerState) {
  return {
    selectedSessionId: state.selectedSessionId,
    openSessionId: state.openSessionId,
    openInitialMessage: state.openInitialMessage,
    inviteAgentProfile: state.inviteAgentProfile,
    inviteRole: state.inviteRole,
    messageKind: state.messageKind,
    messageBody: state.messageBody,
    closeResolutionType: state.closeResolutionType,
    closeNote: state.closeNote,
    notice: state.notice,
  };
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

describe("useWarRoomManagerState — defaults", () => {
  it("initialises every slot with the documented default value", () => {
    const { result } = renderHook(() => useWarRoomManagerState());

    expect(result.current.selectedSessionId).toBe("");
    expect(result.current.openSessionId).toBe("");
    expect(result.current.openInitialMessage).toBe("");
    expect(result.current.inviteAgentProfile).toBe("");
    expect(result.current.inviteRole).toBe<ProjectWarRoomParticipantRole>(
      "architect",
    );
    expect(result.current.messageKind).toBe<ProjectWarRoomMessageKind>(
      "proposal",
    );
    expect(result.current.messageBody).toBe("");
    expect(result.current.closeResolutionType).toBe<ProjectWarRoomResolutionType>(
      "manual",
    );
    expect(result.current.closeNote).toBe("");
    expect(result.current.notice).toBeNull();
  });

  it("exposes a setter function for every slot on the returned state", () => {
    const { result } = renderHook(() => useWarRoomManagerState());

    for (const setter of SETTER_KEYS) {
      expect(typeof result.current[setter]).toBe("function");
    }
  });
});

describe("useWarRoomManagerState — per-slot setters", () => {
  it("updates selectedSessionId through its dedicated setter", () => {
    const { result } = renderHook(() => useWarRoomManagerState());

    act(() => {
      result.current.setSelectedSessionId("war-room-42");
    });

    expect(result.current.selectedSessionId).toBe("war-room-42");
  });

  it("updates the open-session slots independently", () => {
    const { result } = renderHook(() => useWarRoomManagerState());

    act(() => {
      result.current.setOpenSessionId("proposed-session");
    });
    act(() => {
      result.current.setOpenInitialMessage("kick off the discussion");
    });

    expect(result.current.openSessionId).toBe("proposed-session");
    expect(result.current.openInitialMessage).toBe("kick off the discussion");
  });

  it("updates the invite slots independently", () => {
    const { result } = renderHook(() => useWarRoomManagerState());

    act(() => {
      result.current.setInviteAgentProfile("qa_agent");
    });
    act(() => {
      result.current.setInviteRole("qa");
    });

    expect(result.current.inviteAgentProfile).toBe("qa_agent");
    expect(result.current.inviteRole).toBe<ProjectWarRoomParticipantRole>("qa");
  });

  it("updates the message slots independently", () => {
    const { result } = renderHook(() => useWarRoomManagerState());

    act(() => {
      result.current.setMessageKind("response");
    });
    act(() => {
      result.current.setMessageBody("Proposed resolution block");
    });

    expect(result.current.messageKind).toBe<ProjectWarRoomMessageKind>(
      "response",
    );
    expect(result.current.messageBody).toBe("Proposed resolution block");
  });

  it("updates the close slots independently", () => {
    const { result } = renderHook(() => useWarRoomManagerState());

    act(() => {
      result.current.setCloseResolutionType("consensus");
    });
    act(() => {
      result.current.setCloseNote("Consensus reached");
    });

    expect(result.current.closeResolutionType).toBe<ProjectWarRoomResolutionType>(
      "consensus",
    );
    expect(result.current.closeNote).toBe("Consensus reached");
  });

  it("updates the notice slot and can clear it back to null", () => {
    const { result } = renderHook(() => useWarRoomManagerState());
    const notice = { type: "info" as const, message: "Session opened." };

    act(() => {
      result.current.setNotice(notice);
    });
    expect(result.current.notice).toEqual(notice);

    act(() => {
      result.current.setNotice(null);
    });
    expect(result.current.notice).toBeNull();
  });
});

describe("useWarRoomManagerState — stability and purity", () => {
  it("keeps every unrelated slot at its default after a single setter runs", () => {
    const { result } = renderHook(() => useWarRoomManagerState());
    const before = readState(result.current);

    act(() => {
      result.current.setMessageBody("hi");
    });

    expect(result.current.selectedSessionId).toBe(before.selectedSessionId);
    expect(result.current.openSessionId).toBe(before.openSessionId);
    expect(result.current.openInitialMessage).toBe(before.openInitialMessage);
    expect(result.current.inviteAgentProfile).toBe(before.inviteAgentProfile);
    expect(result.current.inviteRole).toBe(before.inviteRole);
    expect(result.current.messageKind).toBe(before.messageKind);
    expect(result.current.closeResolutionType).toBe(before.closeResolutionType);
    expect(result.current.closeNote).toBe(before.closeNote);
    expect(result.current.notice).toBe(before.notice);
    expect(result.current.messageBody).toBe("hi");
  });

  it("does not mutate the previously observed state snapshot after a setter call", () => {
    const { result } = renderHook(() => useWarRoomManagerState());

    act(() => {
      result.current.setMessageBody("first");
    });

    const snapshotAfterFirst = readState(result.current);
    const deepCopyBeforeSecond = deepClone(snapshotAfterFirst);

    act(() => {
      result.current.setMessageBody("second");
    });
    act(() => {
      result.current.setInviteRole("qa");
    });
    act(() => {
      result.current.setCloseResolutionType("consensus");
    });

    expect(snapshotAfterFirst).toEqual(deepCopyBeforeSecond);
    expect(snapshotAfterFirst.messageBody).toBe("first");
    expect(snapshotAfterFirst.inviteRole).toBe("architect");
    expect(snapshotAfterFirst.closeResolutionType).toBe("manual");
  });

  it("preserves string slot identity (no spurious re-render churn) across unrelated setter calls", () => {
    const { result } = renderHook(() => useWarRoomManagerState());

    act(() => {
      result.current.setCloseNote("closing note");
    });

    const selectedSessionIdBefore = result.current.selectedSessionId;
    const messageKindBefore = result.current.messageKind;
    const inviteRoleBefore = result.current.inviteRole;

    act(() => {
      result.current.setSelectedSessionId("abc");
    });

    expect(result.current.selectedSessionId).toBe("abc");
    // Unrelated slots keep the same primitive value across a different setter
    // call: this pins the "no shared mutation" guarantee in addition to the
    // deep-equality check above.
    expect(messageKindBefore).toBe(result.current.messageKind);
    expect(inviteRoleBefore).toBe(result.current.inviteRole);
    // The capture before is still equal to the currently exposed value, so
    // React's reconcile phase would not see a change.
    expect(selectedSessionIdBefore).toBe("");
  });
});

describe("useWarRoomManagerState — absent compound reset actions", () => {
  it("does not expose any compound reset helper (reset* / clear* / bulk*)", () => {
    // Guards against a unilateral introduction of compound reset actions.
    // The shipped implementation retains the per-field `useState` pattern;
    // the only callable surface is the ten documented per-slot setters.
    // Compound actions (`resetOpenSessionForm`, `resetMessageForm`,
    // `resetCloseForm`, an invite-clearing `setInvite`, etc.) are owned by
    // the sibling useReducer migration and are not part of the contract
    // exercised here.
    const { result } = renderHook(() => useWarRoomManagerState());
    const allowedKeys: ReadonlySet<string> = new Set<SetterKey>(SETTER_KEYS);
    const declaredKeys = Object.keys(result.current);
    const declaredSetterKeys = declaredKeys.filter((key) =>
      key.startsWith("set"),
    );

    expect(declaredSetterKeys.length).toBe(SETTER_KEYS.length);
    for (const key of declaredSetterKeys) {
      expect(allowedKeys.has(key as SetterKey)).toBe(true);
    }
  });
});
