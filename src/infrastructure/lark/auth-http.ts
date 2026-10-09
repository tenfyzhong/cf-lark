import { ServiceError } from '../../domain/errors';
import type { Brand, JsonObject } from '../../domain/models';
import { endpoints } from '../../domain/upstream';
import type { AppCredentials, DevicePoll, UpstreamAuth, UpstreamToken } from '../../ports/credentials';

export class LarkAuthHttp implements UpstreamAuth {
    constructor(private readonly send: (request: Request) => Promise<Response> = (request) => fetch(request)) {}

    private async request(url: string, init: RequestInit, allowOAuthError = false, allowEmpty = false): Promise<JsonObject> {
        let response: Response;
        try { response = await this.send(new Request(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(20_000) })); }
        catch { throw new ServiceError('AUTH_UPSTREAM_UNAVAILABLE', 'The upstream authorization service could not be reached.', 502); }
        if (!response.ok && !allowOAuthError) {
            throw new ServiceError('UPSTREAM_AUTH_ERROR', 'Upstream authorization failed; check credentials and permissions.', 401);
        }
        let body: JsonObject;
        try {
            const text = await response.text();
            body = allowEmpty && response.ok && !text.trim() ? {} : JSON.parse(text) as JsonObject;
            if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid envelope');
        }
        catch { throw new ServiceError('AUTH_UPSTREAM_INVALID', 'The authorization service returned an invalid response.', 502); }
        if (allowOAuthError && typeof body.error === 'string') return { error: body.error };
        if (!response.ok || body.error || (body.code !== undefined && body.code !== 0)) {
            throw new ServiceError('UPSTREAM_AUTH_ERROR', 'Upstream authorization failed; check credentials and permissions.', 401);
        }
        return (body.data ?? body) as JsonObject;
    }

    async appUserScopes(app: AppCredentials): Promise<string[]> {
        const { tenant_access_token: token } = await this.tenantToken(app);
        let body: JsonObject;
        try {
            body = await this.request(`${endpoints(app.brand).open}/open-apis/application/v6/applications/${encodeURIComponent(app.appId)}?lang=en_us`, {
                headers: { Authorization: `Bearer ${token}` },
            });
        } catch (error) {
            if (error instanceof ServiceError && error.code === 'UPSTREAM_AUTH_ERROR') {
                throw new ServiceError('APP_SCOPES_UNAVAILABLE', 'Cannot read application permissions. Check the application information permission in the Lark developer console.', 502);
            }
            throw error;
        }
        const info = body.app as { scopes?: unknown } | undefined;
        if (!info || !Array.isArray(info.scopes)) {
            throw new ServiceError('APP_SCOPES_UNAVAILABLE', 'The application information response did not include permissions.', 502);
        }
        const scopes: string[] = [];
        for (const entry of info.scopes) {
            if (!entry || typeof entry.scope !== 'string' || !Array.isArray(entry.token_types)) {
                throw new ServiceError('APP_SCOPES_UNAVAILABLE', 'The application permission list was invalid.', 502);
            }
            if (entry.scope && entry.token_types.includes('user')) scopes.push(entry.scope);
        }
        return [...new Set(scopes)];
    }

    async beginDevice(app: AppCredentials, scopes: string[]) {
        const body = await this.request(endpoints(app.brand).accounts + '/oauth/v1/device_authorization', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${btoa(`${app.appId}:${app.appSecret}`)}` },
            body: new URLSearchParams({ client_id: app.appId, scope: scopes.join(' ') }).toString(),
        });
        if (typeof body.device_code !== 'string' || typeof body.verification_uri !== 'string' || typeof body.expires_in !== 'number') {
            throw new ServiceError('AUTH_UPSTREAM_INVALID', 'The device authorization response was incomplete.', 502);
        }
        const uri = new URL(String(body.verification_uri_complete || body.verification_uri));
        if (uri.protocol !== 'https:' || ![new URL(endpoints(app.brand).open).host, new URL(endpoints(app.brand).accounts).host].includes(uri.host)) {
            throw new ServiceError('AUTH_UPSTREAM_INVALID', 'Unexpected verification URL.', 502);
        }
        return { device_code: body.device_code, verification_uri: body.verification_uri,
            verification_uri_complete: body.verification_uri_complete as string | undefined,
            expires_in: body.expires_in, interval: typeof body.interval === 'number' ? body.interval : 5 };
    }

    async pollDevice(app: AppCredentials, code: string): Promise<DevicePoll> {
        const body = await this.tokenRequest(app, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: code }, true);
        return typeof body.error === 'string' ? { error: body.error } : this.requireToken(body);
    }

    async refresh(app: AppCredentials, token: string): Promise<UpstreamToken> {
        return this.requireToken(await this.tokenRequest(app, { grant_type: 'refresh_token', refresh_token: token }));
    }

    private tokenRequest(app: AppCredentials, values: Record<string, string>, allowError = false) {
        return this.request(endpoints(app.brand).open + '/open-apis/authen/v2/oauth/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ ...values, client_id: app.appId, client_secret: app.appSecret }).toString(),
        }, allowError);
    }

    private requireToken(body: JsonObject): UpstreamToken {
        if (typeof body.access_token !== 'string' || !body.access_token || typeof body.expires_in !== 'number' || body.expires_in <= 0) {
            throw new ServiceError('AUTH_UPSTREAM_INVALID', 'The authorization service did not return a valid token.', 502);
        }
        return body as unknown as UpstreamToken;
    }

    async userInfo(brand: Brand, token: string) {
        const body = await this.request(endpoints(brand).open + '/open-apis/authen/v1/user_info', { headers: { Authorization: `Bearer ${token}` } });
        if (typeof body.open_id !== 'string' || !body.open_id) throw new ServiceError('AUTH_UPSTREAM_INVALID', 'The user identity response was incomplete.', 502);
        return { open_id: body.open_id, name: typeof body.name === 'string' ? body.name : undefined };
    }

    async tenantToken(app: AppCredentials) {
        const body = await this.request(endpoints(app.brand).open + '/open-apis/auth/v3/tenant_access_token/internal', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: app.appId, app_secret: app.appSecret }),
        });
        if (typeof body.tenant_access_token !== 'string' || typeof body.expire !== 'number' || body.expire <= 0) {
            throw new ServiceError('AUTH_UPSTREAM_INVALID', 'The authorization service did not return a tenant token.', 502);
        }
        return { tenant_access_token: body.tenant_access_token, expire: body.expire };
    }

    async revoke(app: AppCredentials, token: string): Promise<void> {
        await this.request(endpoints(app.brand).accounts + '/oauth/v1/revoke', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: app.appId, client_secret: app.appSecret, token }).toString(),
        }, false, true);
    }
}
