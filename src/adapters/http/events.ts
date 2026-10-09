import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { EventService } from '../../application/events';
import { safeError, ServiceError } from '../../domain/errors';

export function eventRoutes(events: EventService) {
    const app = new Hono();
    app.use('*', bodyLimit({ maxSize: 1024 * 1024, onError: () => new Response('Request too large.', { status: 413 }) }));
    app.onError((error, context) => context.json(safeError(error), error instanceof ServiceError ? error.status as 400 : 500));
    app.post('/callbacks/lark/:profile', async (context) => context.json(await events.receive(context.req.param('profile'), {
        body: await context.req.text(), timestamp: context.req.header('X-Lark-Request-Timestamp'),
        nonce: context.req.header('X-Lark-Request-Nonce'), signature: context.req.header('X-Lark-Signature'),
    })));
    return app;
}
