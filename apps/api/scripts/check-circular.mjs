#!/usr/bin/env node
/**
 * Circular-dependency ratchet for apps/api.
 *
 * Fails (exit 1) when the number of circular import chains under `src` exceeds
 * the ratcheted baseline. The baseline only ever moves DOWN: when a refactor
 * removes cycles, lower BASELINE to the new count so the floor cannot regrow.
 *
 * The remaining cycles are genuine, tightly-coupled workflow-engine dependencies
 * (WorkflowCore / StepExecution / RunOperations / ExecutionLifecycle, the Session
 * hydration cluster, Memory <-> Learning) where forwardRef() is the legitimate
 * NestJS mechanism. The ratchet prevents NEW cycles while those are addressed
 * incrementally. See docs/architecture/ADR-0001-api-module-dependency-inversion.md.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import madge from 'madge';

const BASELINE = 32;

async function countCircular() {
  // Mirror the CLI's .madgerc so this matches `npm run madge:circular`.
  const config = JSON.parse(
    readFileSync(new URL('../.madgerc', import.meta.url)),
  );
  const result = await madge('src', config);
  return result.circular().length;
}

export function evaluate(count, baseline = BASELINE) {
  return { ok: count <= baseline, count, baseline };
}

// Only run the side-effecting check when invoked directly (not when imported by a test).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const count = await countCircular();
  const { ok } = evaluate(count);
  if (!ok) {
    console.error(
      `✗ Circular dependencies increased: found ${count}, baseline is ${BASELINE}.\n` +
        `  Do not add new module/provider cycles. Break the cycle with a leaf module or\n` +
        `  lazy ModuleRef resolution; never lower the bar by raising BASELINE.`,
    );
    process.exit(1);
  }
  console.log(
    `✓ Circular dependencies within budget: ${count} <= ${BASELINE} baseline.`,
  );
}
