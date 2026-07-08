import { AgentProfileChangePayloadSchema } from "@nexus/core";
import { ImprovementProposal } from "@/lib/api/client.improvement-proposals.types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProposalRollbackButton } from "./ProposalRollbackButton";
import { formatProfilePatchEntries } from "./improvements-detail.helpers";

export interface AgentProfileChangeDetailProps {
  proposal: ImprovementProposal;
}

/**
 * Readable detail view for `agent_profile_change` proposals: the target
 * profile, the human-authored `changeSummary`, a field-by-field diff table
 * of the proposed patch, and — once applied — a rollback control.
 */
export function AgentProfileChangeDetail({
  proposal,
}: AgentProfileChangeDetailProps) {
  const parsedPayload = AgentProfileChangePayloadSchema.safeParse(
    proposal.payload,
  );

  if (!parsedPayload.success) {
    return (
      <p className="text-sm text-destructive">
        Malformed agent_profile_change payload: {parsedPayload.error.message}
      </p>
    );
  }

  const payload = parsedPayload.data;
  const entries = formatProfilePatchEntries(payload, proposal.rollback_data);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">
            Agent profile
          </h4>
          <p className="text-sm font-medium">{payload.profileName}</p>
        </div>
        <ProposalRollbackButton proposal={proposal} />
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">
          Change summary
        </h4>
        <p className="text-sm">{payload.changeSummary}</p>
      </div>

      <ProfilePatchTable entries={entries} />
    </div>
  );
}

function ProfilePatchTable({
  entries,
}: {
  entries: ReturnType<typeof formatProfilePatchEntries>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Field</TableHead>
          <TableHead>From</TableHead>
          <TableHead>To</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.field}>
            <TableCell className="font-mono text-xs">{entry.field}</TableCell>
            <TableCell
              className={
                entry.from === undefined ? "text-muted-foreground" : undefined
              }
            >
              {entry.from ?? "—"}
            </TableCell>
            <TableCell>{entry.to}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
