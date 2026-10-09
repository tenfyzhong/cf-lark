import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { OAuthHelpers, ConsentDescription } from '@cloudflare/workers-oauth-provider';
import type { CredentialService } from '../../application/credentials';
import type { ManagementSessions } from '../../ports/admin';
import type { Grant } from '../../domain/models';
import { safeError, ServiceError } from '../../domain/errors';

interface ConsentStorage {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
}
type Bindings = { OAUTH_PROVIDER?: OAuthHelpers };
const selectionSchema = z.object({
    profiles: z.array(z.object({ profileId: z.string(), accounts: z.array(z.string()).max(100), identities: z.array(z.enum(['user', 'bot'])).min(1).max(2) })).min(1).max(100),
    domains: z.array(z.string()).min(1).max(100), permissions: z.array(z.enum(['read', 'write'])).min(1).max(2),
});

export function consentRoutes(credentials: CredentialService, sessions: ManagementSessions, storage: ConsentStorage, domains: readonly string[]) {
    const app = new Hono<{ Bindings: Bindings }>();
    app.use('*', bodyLimit({ maxSize: 1024 * 1024, onError: () => Response.json({ code: 'BODY_TOO_LARGE', message: 'The request exceeds 1 MiB.' }, { status: 413 }) }));
    app.onError((error, context) => context.json(safeError(error), error instanceof ServiceError ? error.status as 400 : 400));
    app.use('*', async (context, next) => {
        context.header('Cache-Control', 'no-store');
        context.header('X-Frame-Options', 'DENY');
        if (context.req.path !== '/authorize') await sessions.require(context.req.raw);
        await next();
    });
    app.get('/authorize', async (context) => {
        const provider = context.env.OAUTH_PROVIDER!;
        const request = await provider.parseAuthRequest(context.req.raw);
        if (request.codeChallengeMethod !== 'S256' || !request.codeChallenge || !request.scope.includes('mcp:read')) {
            throw new ServiceError('INVALID_AUTHORIZATION', 'S256 PKCE and the mcp:read scope are required.');
        }
        const description = await provider.describeConsent(request);
        const consent = await provider.beginConsent(request);
        await storage.put(`consent:${consent.handle}`, JSON.stringify(description), { expirationTtl: 600 });
        consent.headers.set('Location', `/consent?handle=${encodeURIComponent(consent.handle)}`);
        return new Response(null, { status: 302, headers: consent.headers });
    });
    app.get('/api/admin/consent/:handle', async (context) => {
        const stored = await storage.get(`consent:${context.req.param('handle')}`);
        if (!stored) throw new ServiceError('CONSENT_EXPIRED', 'Restart authorization from your MCP client.', 404);
        const profiles = await Promise.all((await credentials.list()).map(async (profile) => ({ ...profile, accounts: await credentials.accounts(profile.id) })));
        return context.json({ client: JSON.parse(stored), profiles, domains });
    });
    app.post('/api/admin/consent/:handle', async (context) => {
        const handle = context.req.param('handle');
        const stored = await storage.get(`consent:${handle}`);
        if (!stored) throw new ServiceError('CONSENT_EXPIRED', 'Restart authorization from your MCP client.', 404);
        const description = JSON.parse(stored) as ConsentDescription;
        const selected = selectionSchema.parse(await context.req.json());
        if (selected.domains.some((domain) => !domains.includes(domain))
            || !selected.permissions.includes('read')
            || (selected.permissions.includes('write') && !description.scope.includes('mcp:write'))) {
            throw new ServiceError('INVALID_SELECTION', 'Selected permissions exceed the authorization request.');
        }
        for (const selection of selected.profiles) {
            await credentials.get(selection.profileId);
            const accounts = await credentials.accounts(selection.profileId);
            if (selection.accounts.some((id) => !accounts.some((account) => account.id === id))
                || (selection.identities.includes('user') && !selection.accounts.length)) {
                throw new ServiceError('INVALID_SELECTION', 'Select an existing account for user identity.');
            }
        }
        const provider = context.env.OAUTH_PROVIDER!;
        const approved = await provider.approveConsent(context.req.raw, handle, {
            scope: description.scope.filter((scope) => scope !== 'mcp:write' || selected.permissions.includes('write')),
        });
        const grant: Grant = { ...selected, id: crypto.randomUUID(), expiresAt: Date.now() + 30 * 86400_000, revoked: false };
        const result = await provider.completeAuthorization({ request: approved.request, userId: 'owner', metadata: { name: description.clientName, grantId: grant.id }, scope: approved.request.scope, props: grant });
        await storage.delete(`consent:${handle}`);
        return Response.json(result, { headers: approved.headers });
    });
    app.delete('/api/admin/consent/:handle', async (context) => {
        const result = await context.env.OAUTH_PROVIDER!.denyConsent(context.req.raw, context.req.param('handle'));
        await storage.delete(`consent:${context.req.param('handle')}`);
        return Response.json({ redirectTo: result.redirectTo }, { headers: result.headers });
    });
    app.get('/api/admin/grants', async (context) => context.json(await context.env.OAUTH_PROVIDER!.listUserGrants('owner', { limit: 100, cursor: context.req.query('cursor') })));
    app.delete('/api/admin/grants/:id', async (context) => {
        await context.env.OAUTH_PROVIDER!.revokeGrant(context.req.param('id'), 'owner');
        return context.json({ ok: true });
    });
    return app;
}
