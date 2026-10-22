import type { OrchestrationEvent } from '@tcs/shared-types';

type Listener = (event: OrchestrationEvent) => void;

/**
 * In-memory pub/sub bridging the orchestration watchers to SSE subscribers.
 * (Single-instance by design; swap for Redis pub/sub when scaling out.)
 */
export class RunEventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(runId: string, listener: Listener): () => void {
    let set = this.listeners.get(runId);
    if (!set) this.listeners.set(runId, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(runId);
    };
  }

  publish(event: OrchestrationEvent): void {
    for (const listener of [...(this.listeners.get(event.runId) ?? [])]) {
      listener(event);
    }
  }
}
