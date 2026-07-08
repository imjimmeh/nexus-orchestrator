/**
 * Canonical scaffold for kanban MCP internal tools.
 *
 * Every concrete tool under `apps/kanban/src/mcp/tools/` is responsible for
 * three pieces of plumbing:
 *
 *   1. A stable tool name (returned from `getName()`).
 *   2. A static `RuntimeCapabilityDefinition` (returned from `getDefinition()`).
 *   3. A single async `execute(context, params)` entry point that performs the
 *      domain-specific work.
 *
 * The first two are pure data and identical in shape across all 57 tool
 * implementations surveyed today. The third differs only in business logic —
 * every tool exposes the same `(InternalToolExecutionContext, TParams)`
 * signature, returning `Promise<TResult>`.
 *
 * `KanbanTool` captures that shared scaffold so future tool classes can focus
 * on the unique `run(context, params)` body. The abstract class implements
 * `IInternalToolHandler` from `@nexus/core` and:
 *
 *   - Stores the tool name and definition in `protected readonly` fields
 *     supplied via the constructor so subclasses cannot mutate them.
 *   - Finalises `getName()` and `getDefinition()` (do not override — the
 *     spec contract is to return the constructor-supplied values).
 *   - Finalises `execute(context, params)` to delegate to the protected
 *     abstract `run(context, params)` extension point, preserving the
 *     exact `IInternalToolHandler.execute` signature for consumers.
 *
 * Migration of existing tools to this base class is intentionally deferred to
 * a follow-up milestone; this file only introduces the scaffold and does not
 * touch any existing implementation.
 *
 * Signatures observed during the survey (all preserved by this base class):
 *   - `execute(context: InternalToolExecutionContext, params: TParams)`
 *   - 53 of 57 surveyed implementations declared `async execute(...)`; the
 *     remaining 4 returned `Promise.resolve(...)` from a synchronous
 *     `execute`. Both styles satisfy the `Promise<TResult>` contract, and
 *     subclasses may use either form when implementing `run`.
 *   - `tierRestriction` is uniformly `2` for all surveyed tools except
 *     `kanban.propose_work_items`, which uses `1`. The base class does not
 *     hard-code a tier; subclasses pass the appropriate value through the
 *     constructor-supplied definition.
 *   - `transport` and `runtimeOwner` are uniformly `"runner_local"` and
 *     `"runner"` respectively. They are simply passed through the
 *     constructor-supplied definition.
 */
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from "@nexus/core";

/**
 * Abstract scaffold for kanban MCP internal tools.
 *
 * Subclasses must:
 *   - Decorate themselves with `@Injectable()` so NestJS can resolve them.
 *   - Forward `name` and `definition` to `super(name, definition)` from
 *     their own constructor.
 *   - Implement `protected abstract run(context, params): Promise<TResult>`
 *     with the tool-specific business logic.
 *
 * Subclasses must NOT override `getName`, `getDefinition`, or `execute`;
 * those are final on the scaffold by contract.
 */
export abstract class KanbanTool<
  TParams = unknown,
  TResult = Record<string, unknown>,
> implements IInternalToolHandler<TParams, TResult>
{
  protected readonly name: string;
  protected readonly definition: RuntimeCapabilityDefinition;

  constructor(name: string, definition: RuntimeCapabilityDefinition) {
    this.name = name;
    this.definition = definition;
  }

  /** Final: returns the constructor-supplied tool name. */
  public getName(): string {
    return this.name;
  }

  /** Final: returns the constructor-supplied tool definition. */
  public getDefinition(): RuntimeCapabilityDefinition {
    return this.definition;
  }

  /**
   * Final: delegates to the protected `run` extension point. Preserves the
   * exact `IInternalToolHandler.execute` signature so existing consumers
   * (e.g. `KanbanMcpService`, `KanbanMcpManifestValidationService`) and
   * existing unit tests that call `tool.execute(context, params)` continue
   * to work without modification.
   */
  public async execute(
    context: InternalToolExecutionContext,
    params: TParams,
  ): Promise<TResult> {
    return this.run(context, params);
  }

  /**
   * Extension point: subclasses implement the tool-specific business logic
   * here. Returning a `Promise<TResult>` is required to satisfy
   * `IInternalToolHandler.execute`.
   */
  protected abstract run(
    context: InternalToolExecutionContext,
    params: TParams,
  ): Promise<TResult>;
}