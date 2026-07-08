# Pending Product Decision: Authentication Strategy

Status: Pending owner input
Last updated: 2026-06-04

## Context

The platform must support authenticated access for operators and end users.
Two viable approaches have been identified, and the team is blocked on a
product decision before implementation can proceed.

## Options

1. **External identity provider.** Delegate authentication to an established
   identity provider. Pros: reduced operational burden, federation with
   partner organisations. Cons: dependency on third-party availability,
   higher per-seat cost.

2. **Self-hosted identity store.** Operate an in-house identity store with
   password, MFA, and session management. Pros: full control over data and
   policies. Cons: ongoing operational cost, slower rollout of new identity
   features.

## Open Questions

- Should the platform delegate authentication to an external identity
  provider, or maintain a self-hosted identity store?
- What is the acceptable onboarding latency for the chosen approach?
- Does the chosen approach need to support delegated admin operators?

## Decision

Awaiting product owner input. Implementation work is on hold until a
direction is selected.
