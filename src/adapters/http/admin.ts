import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { CredentialService } from '../../application/credentials';
import type { ManagementSessions } from '../../ports/admin';
import { safeError, ServiceError } from '../../domain/errors';
import type { ArtifactService } from '../../application/artifacts';
import type { EventManagement } from '../../ports/events';

export function adminRoutes(credentials: CredentialService, sessions: ManagementSessions, artifacts: ArtifactService, events: EventManagement) {
    const app = new Hono();
    app.use('*', async (context, next) => context.req.path === '/api/admin/artifacts'
        ? next() : bodyLimit({ maxSize: 1024 * 1024, onError: () => Response.json({ code: 'BODY_TOO_LARGE', message: 'The request exceeds 1 MiB.' }, { status: 413 }) })(context, next));
    app.onError((error, context) => {
        if (error instanceof z.ZodError || error instanceof SyntaxError) {
            return context.json({ code: 'INVALID_ARGUMENTS', message: 'The request body is invalid.' }, 400);
        }
        return context.json(safeError(error), error instanceof ServiceError ? error.status as 400 : 500);
    });
    app.use('*', async (context, next) => {
        context.header('Cache-Control', 'no-store');
        context.header('X-Content-Type-Options', 'nosniff');
        if (context.req.path !== '/api/admin/login') await sessions.require(context.req.raw);
        await next();
    });
    app.post('/api/admin/login', (context) => context.json({
        code: 'LOGIN_REMOVED', message: 'Secret login is no longer supported. Use Cloudflare Access.',
    }, 410));
    app.get('/api/admin/access-login', (context) => {
        const value = context.req.query('returnTo') ?? '/';
        const target = new URL(value, context.req.url);
        if (!value.startsWith('/') || value.startsWith('//') || target.origin !== new URL(context.req.url).origin
            || !['/', '/consent'].includes(target.pathname) || target.hash) {
            throw new ServiceError('INVALID_RETURN_PATH', 'The login return path is invalid.');
        }
        return context.redirect(target.pathname + target.search, 302);
    });
    app.get('/api/admin/session', async (context) => context.json(await sessions.require(context.req.raw)));
    app.post('/api/admin/logout', async (context) => {
        context.header('Set-Cookie', await sessions.logout(context.req.raw));
        return context.json({ ok: true, redirectTo: '/cdn-cgi/access/logout' });
    });
    app.get('/api/admin/profiles', async (context) => context.json({ profiles: await credentials.list() }));
    app.get('/api/admin/usage', async (context) => context.json(await artifacts.usage()));
    app.post('/api/admin/artifacts', async (context) => {
        const size = Number(context.req.header('Content-Length'));
        if (!context.req.raw.body) throw new ServiceError('INVALID_BODY', 'An upload body is required.');
        return context.json(await artifacts.upload('owner', size, context.req.raw.body), 201);
    });
    app.get('/api/admin/artifacts/:id', async (context) => artifacts.read('owner', context.req.param('id')));
    app.delete('/api/admin/artifacts/:id', async (context) => {
        await artifacts.remove('owner', context.req.param('id'));
        return context.json({ ok: true });
    });
    app.post('/api/admin/profiles', async (context) => {
        const input = z.object({ name: z.string().min(1).max(200), brand: z.enum(['lark', 'feishu']), appId: z.string().min(1).max(200), appSecret: z.string().min(1).max(4096) }).parse(await context.req.json());
        return context.json(await credentials.create(input), 201);
    });
    app.patch('/api/admin/profiles/:id', async (context) => {
        const input = z.object({ name: z.string().min(1).max(200).optional(), appSecret: z.string().min(1).max(4096).optional() }).parse(await context.req.json());
        return context.json(await credentials.update(context.req.param('id'), input));
    });
    app.delete('/api/admin/profiles/:id', async (context) => {
        await events.removeProfile(context.req.param('id'));
        await credentials.remove(context.req.param('id'));
        return context.json({ ok: true });
    });
    app.put('/api/admin/profiles/:id/events', async (context) => {
        const profile = await credentials.get(context.req.param('id'));
        const input = z.object({ verificationToken: z.string().min(1).max(4096), encryptKey: z.string().min(1).max(4096) }).parse(await context.req.json());
        await events.configure(profile.id, { ...input, appId: profile.appId });
        return context.json({ ok: true });
    });
    app.get('/api/admin/profiles/:id/events', async (context) => {
        const profile = await credentials.get(context.req.param('id'));
        return context.json(await events.read(profile.id, Number(context.req.query('cursor') ?? 0), Number(context.req.query('limit') ?? 50)));
    });
    app.get('/api/admin/profiles/:id/accounts', async (context) => context.json({ accounts: await credentials.accounts(context.req.param('id')) }));
    app.delete('/api/admin/profiles/:id/accounts/:account', async (context) => {
        await credentials.logout(context.req.param('id'), context.req.param('account'));
        return context.json({ ok: true });
    });
    app.post('/api/admin/profiles/:id/login', async (context) => {
        return context.json(await credentials.beginLogin(context.req.param('id')));
    });
    app.get('/api/admin/flows/:id', async (context) => context.json(await credentials.flow(context.req.param('id'))));
    app.post('/api/admin/flows/:id/poll', async (context) => context.json(await credentials.pollLogin(context.req.param('id'))));
    app.delete('/api/admin/flows/:id', async (context) => { await credentials.cancelLogin(context.req.param('id')); return context.json({ ok: true }); });
    return app;
}
