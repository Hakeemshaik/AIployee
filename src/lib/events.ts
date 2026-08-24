import { db } from "@/lib/db";
import type { PlatformEventType } from "@/lib/domain";

// ---------------------------------------------------------------------------
// Internal event architecture.
//
// Every domain event (call.completed, promise.created, payment.received, ...)
// flows through emitEvent(). Each event is:
//   1. persisted to PlatformEvent — a durable, replayable event log that an
//      outbound webhook dispatcher or queue consumer can be attached to later;
//   2. delivered to any in-process subscribers registered with onEvent().
//
// Subscriber failures are isolated: a broken handler never breaks the
// business operation that emitted the event.
// ---------------------------------------------------------------------------

export type DomainEvent = {
  type: PlatformEventType;
  organizationId: string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
};

type Handler = (event: DomainEvent) => void | Promise<void>;

const globalForEvents = globalThis as unknown as {
  eventHandlers?: Map<string, Handler[]>;
};
const handlers = (globalForEvents.eventHandlers ??= new Map<string, Handler[]>());

export function onEvent(type: PlatformEventType | "*", handler: Handler): void {
  const list = handlers.get(type) ?? [];
  list.push(handler);
  handlers.set(type, list);
}

export async function emitEvent(event: DomainEvent): Promise<void> {
  await db.platformEvent.create({
    data: {
      organizationId: event.organizationId,
      type: event.type,
      entityType: event.entityType,
      entityId: event.entityId,
      payload: event.payload ? JSON.stringify(event.payload) : null,
    },
  });

  const subscribers = [...(handlers.get(event.type) ?? []), ...(handlers.get("*") ?? [])];
  for (const handler of subscribers) {
    try {
      await handler(event);
    } catch (err) {
      // Never let a subscriber failure break the emitting operation.
      console.error(`[events] handler for ${event.type} failed:`, err);
    }
  }
}
