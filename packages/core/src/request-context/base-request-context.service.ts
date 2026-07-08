import { Injectable } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";

import type { RequestContext } from "./request-context.types";

@Injectable()
export class BaseRequestContextService<
  TContext extends RequestContext = RequestContext,
> {
  protected readonly storage = new AsyncLocalStorage<TContext>();

  run<T>(context: TContext, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  getContext(): TContext | undefined {
    return this.storage.getStore();
  }

  getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }

  getCausationId(): string | undefined {
    return this.storage.getStore()?.causationId;
  }

  protected setContextValue<TKey extends keyof TContext>(
    key: TKey,
    value: TContext[TKey],
  ): void {
    const store = this.storage.getStore();
    if (store) {
      store[key] = value;
    }
  }
}
