import { DurableObject } from 'cloudflare:workers';
import { EventService } from '../application/events';
import { eventRoutes } from '../adapters/http/events';
import { SqliteEventInbox } from '../infrastructure/storage/event-inbox';
import { SecretBox } from '../infrastructure/crypto/secret-box';
import { verifyCallback } from '../infrastructure/lark/event-verifier';
import { SerialExecutor } from '../infrastructure/concurrency/serial-executor';
import type { CallbackConfig } from '../ports/events';

export class EventInbox extends DurableObject<{ ENCRYPTION_KEY: string }> {
    private readonly service: EventService;
    private readonly serial = new SerialExecutor();
    constructor(ctx: DurableObjectState, env: { ENCRYPTION_KEY: string }) {
        super(ctx, env);
        this.service = new EventService(new SqliteEventInbox(ctx.storage.sql), new SecretBox(env.ENCRYPTION_KEY), verifyCallback);
    }

    async fetch(request: Request) {
        return this.serial.run(async () => {
            if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 3600_000);
            return eventRoutes(this.service).fetch(request);
        });
    }
    async configure(profile: string, config: CallbackConfig) { return this.serial.run(async () => { return this.service.configure(profile, config); }); }
    async read(profile: string, cursor: number, limit: number) { return this.serial.run(async () => { return this.service.read(profile, cursor, limit); }); }
    async configured(profile: string) { return this.serial.run(async () => this.service.configured(profile)); }
    async tail(profile: string) { return this.serial.run(async () => this.service.tail(profile)); }
    async removeProfile(profile: string) { return this.serial.run(async () => { return this.service.removeProfile(profile); }); }
    async alarm() {
        await this.serial.run(async () => {
            await this.service.cleanup();
            await this.ctx.storage.setAlarm(Date.now() + 3600_000);
        });
    }
}
