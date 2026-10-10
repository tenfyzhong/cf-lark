import { ServiceError } from '../../domain/errors';
import type { Brand, JsonObject } from '../../domain/models';
import { endpoints } from '../../domain/upstream';
import type { AppCredentials, DeviceAuthorizationState, DevicePoll, OAuthOptions, TokenAuthorization, UpstreamAuth, UpstreamToken } from '../../ports/credentials';

import { authorizationHeaders, generateDpopKey, parseOAuthOptions, tokenProof } from './dpop';

export class LarkAuthHttp implements UpstreamAuth {
    readonly options: OAuthOptions;
    constructor(private readonly send: (request: Request) => Promise<Response> = (request) => fetch(request), options: OAuthOptions = { protocol: 'legacy', dpopMode: 'disabled' }) {
        this.options = parseOAuthOptions(options.protocol, options.dpopMode);
    }

    private async request(url: string, init: RequestInit, options: { pollOAuthErrors?: boolean; inspectOAuthErrors?: boolean; allowEmpty?: boolean } = {}): Promise<JsonObject> {
        let response: Response;
        try { response = await this.send(new Request(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(20_000) })); }
        catch { throw new ServiceError('AUTH_UPSTREAM_UNAVAILABLE', 'The upstream authorization service could not be reached.', 502); }
        if (!response.ok && !options.pollOAuthErrors && !options.inspectOAuthErrors) {
            throw new ServiceError('UPSTREAM_AUTH_ERROR', 'Upstream authorization failed; check credentials and permissions.', 401);
        }
        let body: JsonObject;
        try {
            const text = await response.text();
            body = options.allowEmpty && response.ok && !text.trim() ? {} : JSON.parse(text) as JsonObject;
            if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid envelope');
        }
        catch { throw new ServiceError('AUTH_UPSTREAM_INVALID', 'The authorization service returned an invalid response.', 502); }
        if (body.error === 'invalid_dpop_proof' || body.error === 'use_dpop_nonce') {
            throw new ServiceError('DPOP_TOKEN_REJECTED', 'The authorization service rejected the proof; the stored credential has been preserved.', 401);
        }
        if (options.pollOAuthErrors && typeof body.error === 'string' && ['authorization_pending', 'slow_down', 'access_denied', 'expired_token', 'invalid_grant'].includes(body.error)) return { error: body.error };
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
        const authorization: DeviceAuthorizationState | undefined = this.options.protocol === 'oauthv3'
            ? { ...this.options, ...(this.options.dpopMode === 'disabled' ? {} : { dpopKey: await generateDpopKey() }) } : undefined;
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
            expires_in: body.expires_in, interval: typeof body.interval === 'number' ? body.interval : 5, ...(authorization ? { authorization } : {}) };
    }

    async pollDevice(app: AppCredentials, code: string, state?: DeviceAuthorizationState): Promise<DevicePoll> {
        const policy = state ?? this.options;
        if (policy.dpopMode !== 'disabled' && !state?.dpopKey) throw new ServiceError('DPOP_KEY_MISSING', 'The authorization flow proof key is missing; start authorization again.', 401);
        const body = await this.tokenRequest(app, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: code }, policy.protocol, state?.dpopKey, true);
        return typeof body.error === 'string' ? { error: body.error } : this.requireToken(body, policy.protocol, state?.dpopKey, policy.dpopMode === 'required' || this.options.dpopMode === 'required');
    }

    async refresh(app: AppCredentials, token: string, authorization?: TokenAuthorization): Promise<UpstreamToken> {
        if (this.options.dpopMode === 'required' && authorization?.tokenType !== 'DPoP') {
            throw new ServiceError('DPOP_REQUIRED', 'This deployment requires a bound user credential; authorize again.', 401);
        }
        if (authorization?.tokenType === 'DPoP' && !authorization.dpopKey) throw new ServiceError('DPOP_KEY_MISSING', 'The bound credential proof key is missing; authorize again.', 401);
        if (authorization?.tokenType === 'Bearer' && authorization.dpopKey) throw new ServiceError('DPOP_BINDING_MISMATCH', 'The credential proof binding is inconsistent.', 401);
        const protocol = authorization?.protocol ?? this.options.protocol;
        if (authorization?.dpopKey && protocol !== 'oauthv3') throw new ServiceError('DPOP_BINDING_MISMATCH', 'The bound credential protocol is inconsistent.', 401);
        return this.requireToken(await this.tokenRequest(app, { grant_type: 'refresh_token', refresh_token: token }, protocol, authorization?.dpopKey), protocol, authorization?.dpopKey, authorization?.tokenType === 'DPoP');
    }

    private async tokenRequest(app: AppCredentials, values: Record<string, string>, protocol: OAuthOptions['protocol'], key?: DeviceAuthorizationState['dpopKey'], allowError = false) {
        const url = protocol === 'oauthv3' ? endpoints(app.brand).accounts + '/oauth/v3/token' : endpoints(app.brand).open + '/open-apis/authen/v2/oauth/token';
        const json = protocol === 'oauthv3' && values.grant_type === 'refresh_token';
        const valuesWithCredentials = { ...values, client_id: app.appId, client_secret: app.appSecret };
        return this.request(url, {
            method: 'POST', headers: { 'Content-Type': json ? 'application/json; charset=utf-8' : 'application/x-www-form-urlencoded',
                ...(key ? { DPoP: await tokenProof(key, 'POST', url) } : {}) },
            body: json ? JSON.stringify(valuesWithCredentials) : new URLSearchParams(valuesWithCredentials).toString(),
        }, { pollOAuthErrors: allowError, inspectOAuthErrors: Boolean(key) });
    }

    private requireToken(body: JsonObject, protocol: OAuthOptions['protocol'], key?: DeviceAuthorizationState['dpopKey'], requireBound = false): UpstreamToken {
        if (typeof body.access_token !== 'string' || !body.access_token || typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in) || body.expires_in <= 0) {
            throw new ServiceError('AUTH_UPSTREAM_INVALID', 'The authorization service did not return a valid token.', 502);
        }
        const rawType = typeof body.token_type === 'string' ? body.token_type.toLowerCase() : body.token_type;
        if (rawType !== undefined && rawType !== 'bearer' && rawType !== 'dpop') throw new ServiceError('AUTH_UPSTREAM_INVALID', 'The authorization service returned an unsupported token type.', 502);
        if (rawType === 'dpop' && !key) throw new ServiceError('DPOP_KEY_MISSING', 'A bound token was returned without a local proof key; authorize again.', 401);
        if (rawType !== 'dpop' && (requireBound || (key && rawType !== 'bearer'))) {
            throw new ServiceError('DPOP_REQUIRED', 'The authorization service did not return the required bound token.', 401);
        }
        if (body.refresh_token !== undefined && typeof body.refresh_token !== 'string'
            || body.scope !== undefined && typeof body.scope !== 'string'
            || body.refresh_token_expires_in !== undefined && (typeof body.refresh_token_expires_in !== 'number' || !Number.isFinite(body.refresh_token_expires_in) || body.refresh_token_expires_in < 0)) {
            throw new ServiceError('AUTH_UPSTREAM_INVALID', 'The authorization service returned invalid token metadata.', 502);
        }
        const tokenType = rawType === 'dpop' ? 'DPoP' : 'Bearer';
        return { access_token: body.access_token, expires_in: body.expires_in,
            ...(body.refresh_token === undefined ? {} : { refresh_token: body.refresh_token as string }),
            ...(body.scope === undefined ? {} : { scope: body.scope as string }),
            ...(body.refresh_token_expires_in === undefined ? {} : { refresh_token_expires_in: body.refresh_token_expires_in as number }),
            token_type: tokenType, authorization: { protocol, tokenType, ...(tokenType === 'DPoP' ? { dpopKey: key } : {}) } };
    }

    async userInfo(brand: Brand, token: string, authorization?: TokenAuthorization) {
        const url = endpoints(brand).open + '/open-apis/authen/v1/user_info';
        const body = await this.request(url, { headers: await authorizationHeaders({ accessToken: token, tokenType: authorization?.tokenType ?? 'Bearer', dpopKey: authorization?.dpopKey }, 'GET', url) });
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

    async revoke(app: AppCredentials, token: string, authorization?: TokenAuthorization): Promise<void> {
        if (authorization?.tokenType === 'DPoP' && !authorization.dpopKey) throw new ServiceError('DPOP_KEY_MISSING', 'The bound credential proof key is missing.', 401);
        const url = endpoints(app.brand).accounts + '/oauth/v1/revoke';
        await this.request(url, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(authorization?.dpopKey ? { DPoP: await tokenProof(authorization.dpopKey, 'POST', url) } : {}) },
            body: new URLSearchParams({ client_id: app.appId, client_secret: app.appSecret, token }).toString(),
        }, { allowEmpty: true });
    }
}
