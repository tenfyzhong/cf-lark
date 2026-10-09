import type { ExecutionSelection, JsonObject } from '../domain/models';
export interface EventConsumer {
    id: string;
    owner: string;
    selection: ExecutionSelection;
    key: string;
    params: Record<string, string>;
    group: string;
    cursor: number;
    emitted: number;
    maxEvents: number;
    expiresAt: number;
    revision: number;
    status: 'starting' | 'active' | 'polling' | 'stopping' | 'stopped' | 'failed' | 'uncertain';
    setupIndex: number;
    leader: boolean;
    quiet?: boolean;
    jq?: string;
    outputDir?: string;
    pending?: JsonObject;
    error?: { code: string; message: string };
}
export interface EventConsumerStore {
    revokeOwner(owner: string): Promise<void>;
    ownerRevoked(owner: string): Promise<boolean>;
    create(record: EventConsumer): Promise<void>;
    get(owner: string, id: string): Promise<EventConsumer | undefined>;
    list(owner: string): Promise<EventConsumer[]>;
    prune?(before: number): Promise<number>;
    expired(now: number, limit: number): Promise<EventConsumer[]>;
    transition(record: EventConsumer, expectedRevision: number): Promise<boolean>;
    join(group: string, consumerId: string, single: boolean): Promise<{ leader: boolean }>;
    activate(group: string, consumerId: string): Promise<void>;
    leave(group: string, consumerId: string): Promise<boolean>;
    removeGroup(group: string): Promise<void>;
}
export interface EventQuery {
    process(request: { operation: 'jq'; expression: string; input: unknown } | { operation: 'jq-validate'; expression: string }): Promise<unknown>;
}
export interface EventCardFormatter { formatEvent(rawContent: string, mentions: unknown[]): Promise<string> }
