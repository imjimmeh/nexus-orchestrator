# Session State Management (Dehydration & Rehydration)

The Session Hydration system manages Pi Agent session state, allowing execution to be paused and resumed across physical Docker containers. This is essential for minimizing infrastructure costs and supporting asynchronous human-in-the-loop interventions.

## Architecture

1. **`SessionHydrationService`**
   - Coordinates the process of extracting the state from running containers and injecting state into new containers.
   - Converts raw `.jsonl` files from the Pi Agent into gzip-compressed Base64 strings for storage in PostgreSQL.
   - Provides branching functionality by identifying specific `nodeId` targets for rehydration.

2. **`JSONLValidationService`**
   - Enforces the strict JSON Line format emitted by the Pi Agent.
   - Extracts semantic understanding of the conversation tree (e.g., child-parent linkages).
   - Prevents cycles or corrupted graph states from being permanently persisted.

3. **`SessionCleanupService`**
   - Scheduled via BullMQ.
   - Scans PostgreSQL `PiSessionTrees` to garbage-collect artifacts older than 30 days or belonging to orphaned workflow runs.

## Dehydration Pipeline

1. **SIGUSR1 Signal**: Control plane issues `kill -s SIGUSR1` to the container via `dockerode`. This gracefully pauses the Pi Agent execution.
2. **Extraction**: A `tar` stream reads `/app/.pi/agent/session.jsonl` from the container file system without executing additional internal shell commands.
3. **Validation & Compression**: JSONL passes strict validation, is gzip-compressed, and is pushed to `PiSessionTrees.jsonl_data`.
4. **Termination**: The container is destroyed.

## Rehydration Pipeline

1. **Retrieval & Decompression**: Base64 JSONL data is retrieved from PostgreSQL and unzipped.
2. **Injection**: Data is injected into the newly provisioned container using a reverse `tar` stream bound to `/app/.pi/agent/`.
3. **Execution**: The container is started. If a `nodeId` branch point is set, the container spins up an environment with `RESUME_NODE_ID`.
