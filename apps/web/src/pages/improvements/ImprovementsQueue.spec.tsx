import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CreateSkillAssignmentProposalResult } from "@/lib/api/client.improvement-proposals.types";
import { ImprovementsQueue } from "./ImprovementsQueue";
import { useCreateSkillAssignmentProposal } from "@/hooks/useImprovementProposals";
import { useToast } from "@/hooks/useToast";

vi.mock("../../hooks/useImprovementProposals", () => ({
  useImprovementProposals: () => ({
    proposals: [
      {
        id: "p1",
        kind: "code_change",
        status: "pending",
        confidence: 0.6,
        created_at: "2026-07-02T00:00:00Z",
      },
    ],
    isLoading: false,
    approve: vi.fn(),
    reject: vi.fn(),
    bulkApprove: vi.fn(),
    bulkReject: vi.fn(),
    rollback: vi.fn(),
    filters: {},
    setFilters: vi.fn(),
  }),
  useCreateSkillAssignmentProposal: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: vi.fn(),
}));

vi.mock("./AssignSkillDialog", () => ({
  AssignSkillDialog: ({
    open,
    onSubmit,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (body: unknown) => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() =>
          onSubmit({
            skillName: "merge-hygiene",
            targets: [{ type: "agent_profile", profileName: "merge-agent" }],
          })
        }
      >
        Submit fake assignment
      </button>
    ) : null,
}));

type MutateOptions = {
  onSuccess: (result: CreateSkillAssignmentProposalResult) => void;
  onError: (error: unknown) => void;
};

interface ToastSpy {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  warning: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
}

function setup() {
  const mutate = vi.fn();
  vi.mocked(useCreateSkillAssignmentProposal).mockReturnValue({
    mutate,
  } as unknown as ReturnType<typeof useCreateSkillAssignmentProposal>);
  const toast: ToastSpy = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  };
  vi.mocked(useToast).mockReturnValue(toast);

  render(<ImprovementsQueue />);
  return { mutate, toast };
}

/** Opens the dialog, submits the stubbed body, and returns the options
 *  object the container passed to `mutate` (its onSuccess/onError). */
function openDialogAndSubmit(mutate: ReturnType<typeof vi.fn>): MutateOptions {
  fireEvent.click(screen.getByRole("button", { name: /assign skill/i }));
  fireEvent.click(screen.getByText("Submit fake assignment"));
  return mutate.mock.calls[0][1] as MutateOptions;
}

function isDialogOpen(): boolean {
  return screen.queryByText("Submit fake assignment") !== null;
}

describe("ImprovementsQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a proposal row with its kind and status", () => {
    setup();
    expect(screen.getByText("code_change")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("opens the Assign skill dialog and submits through the create mutation", () => {
    const { mutate } = setup();

    expect(isDialogOpen()).toBe(false);

    const options = openDialogAndSubmit(mutate);

    expect(mutate).toHaveBeenCalledWith(
      {
        skillName: "merge-hygiene",
        targets: [{ type: "agent_profile", profileName: "merge-agent" }],
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
    // Dialog stays open until the mutation resolves.
    expect(isDialogOpen()).toBe(true);
    expect(options).toBeDefined();
  });

  it.each([
    {
      outcome: "auto_applied" as const,
      variant: "success" as const,
      title: "Skill assigned",
      description: "The assignment was applied immediately.",
    },
    {
      outcome: "proposed" as const,
      variant: "info" as const,
      title: "Proposal created",
      description: "The assignment is pending review in the queue.",
    },
    {
      outcome: "dropped" as const,
      variant: "warning" as const,
      title: "Proposal dropped",
      description: "Governance dropped this proposal before it was stored.",
    },
    {
      outcome: "apply_failed" as const,
      variant: "error" as const,
      title: "Assignment failed to apply",
      description: "The proposal was recorded but could not be applied.",
    },
  ])(
    "fires the $variant toast and closes the dialog on a $outcome outcome",
    ({ outcome, variant, title, description }) => {
      const { mutate, toast } = setup();
      const options = openDialogAndSubmit(mutate);

      act(() => {
        options.onSuccess({ outcome, proposal: null });
      });

      expect(toast[variant]).toHaveBeenCalledWith(title, description);
      // Exactly one toast fired — no cross-firing of the other variants.
      const otherVariants = (
        ["success", "info", "warning", "error"] as const
      ).filter((v) => v !== variant);
      for (const other of otherVariants) {
        expect(toast[other]).not.toHaveBeenCalled();
      }
      // Dialog closes on a resolved mutation.
      expect(isDialogOpen()).toBe(false);
    },
  );

  it("fires an error toast and leaves the dialog open when the mutation fails", () => {
    const { mutate, toast } = setup();
    const options = openDialogAndSubmit(mutate);

    act(() => {
      options.onError(new Error("boom"));
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Assign skill failed",
      "Could not create the skill-assignment proposal.",
    );
    expect(toast.success).not.toHaveBeenCalled();
    // A failed create leaves the dialog open so the operator can retry.
    expect(isDialogOpen()).toBe(true);
  });
});
