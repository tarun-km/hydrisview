import { EventEmitter } from 'node:events';
import type { Permission } from '@hydris/domain';

/**
 * In-process domain event bus feeding the realtime hub. Each event names the tenant,
 * optional site, and the permission a subscriber needs to receive it, so the hub can
 * authorize delivery per connection. Swap for Redis pub/sub when running >1 instance.
 */
export interface DomainEvent {
  id: number;
  type: string;
  orgId: string;
  siteId?: string | null;
  permission?: Permission;
  /** Restrict delivery to these users (e.g. personal notifications). */
  userIds?: string[];
  /** Restrict delivery to these devices. */
  deviceIds?: string[];
  payload: unknown;
  at: string;
}

export class EventBus {
  private emitter = new EventEmitter();
  private seq = 0;
  private ring: DomainEvent[] = [];

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(e: Omit<DomainEvent, 'id' | 'at'>): DomainEvent {
    const ev: DomainEvent = { ...e, id: ++this.seq, at: new Date().toISOString() };
    this.ring.push(ev);
    if (this.ring.length > 1000) this.ring.shift();
    this.emitter.emit('event', ev);
    return ev;
  }

  subscribe(fn: (e: DomainEvent) => void): () => void {
    this.emitter.on('event', fn);
    return () => this.emitter.off('event', fn);
  }

  /** Events after `lastId` for replay on reconnect (Last-Event-ID). */
  since(lastId: number): DomainEvent[] {
    return this.ring.filter((e) => e.id > lastId);
  }
}
