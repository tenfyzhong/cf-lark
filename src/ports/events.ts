export interface InboxEvent { id: string; type: string; payload: Record<string, unknown> }
export interface EventPage { events: (InboxEvent & { sequence: number })[]; cursor: number }
export interface EventInbox {
    append(profile: string, event: InboxEvent): Promise<boolean>;
    read(profile: string, cursor: number, limit: number): Promise<EventPage>;
    tail?(profile: string): Promise<number>;
    getSettings(profile: string): Promise<string | undefined>;
    putSettings(profile: string, encrypted: string): Promise<void>;
    removeProfile(profile: string): Promise<void>;
    cleanup(): Promise<void>;
}
export interface CallbackConfig { appId: string; verificationToken: string; encryptKey: string }
export interface CallbackInput { body: string; timestamp?: string; nonce?: string; signature?: string }
export type CallbackVerifier = (input: CallbackInput, config: CallbackConfig) => Promise<InboxEvent | { challenge: string }>;
export interface EventManagement {
    configured?(profile: string): Promise<boolean>;
    configure(profile: string, config: CallbackConfig): Promise<void>;
    read(profile: string, cursor: number, limit: number): Promise<EventPage>;
    tail?(profile: string): Promise<number>;
    removeProfile(profile: string): Promise<void>;
}
