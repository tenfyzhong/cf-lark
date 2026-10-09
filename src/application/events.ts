import type { CallbackConfig, CallbackInput, CallbackVerifier, EventInbox } from '../ports/events';
import type { Encryption } from '../ports/credentials';
import { ServiceError } from '../domain/errors';

export class EventService {
    constructor(private readonly inbox: EventInbox, private readonly encryption: Encryption, private readonly verify: CallbackVerifier) {}
    async configure(profile: string, config: CallbackConfig) {
        if (!config.appId || !config.verificationToken || !config.encryptKey) throw new ServiceError('INVALID_EVENT_CONFIGURATION', 'All callback credentials are required.');
        await this.inbox.putSettings(profile, await this.encryption.encrypt(`events:${profile}`, JSON.stringify(config)));
    }
    async receive(profile: string, input: CallbackInput) {
        const encrypted = await this.inbox.getSettings(profile);
        if (!encrypted) throw new ServiceError('CALLBACK_NOT_FOUND', 'The callback is not configured.', 404);
        const config = JSON.parse(await this.encryption.decrypt(`events:${profile}`, encrypted)) as CallbackConfig;
        const result = await this.verify(input, config);
        if ('challenge' in result) return result;
        await this.inbox.append(profile, result);
        return { code: 0 };
    }
    async configured(profile: string) { return Boolean(await this.inbox.getSettings(profile)); }
    async tail(profile: string) { return await this.inbox.tail?.(profile) ?? 0; }
    read(profile: string, cursor: number, limit: number) { return this.inbox.read(profile, cursor, limit); }
    removeProfile(profile: string) { return this.inbox.removeProfile(profile); }
    cleanup() { return this.inbox.cleanup(); }
}
