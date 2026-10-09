import { EventConsumeService, createEventConsumerCleanup } from '../capabilities/event/index';
import { SqliteEventConsumerStore } from '../infrastructure/storage/event-consumers';
import { EncryptedWorkflowBlobs } from '../infrastructure/storage/workflow-blobs';
import { RemotePureEngine } from '../infrastructure/http/pure-engine';
import { CloudflareContentHasher } from '../infrastructure/crypto/content-hasher';
import { ArtifactUploadService } from '../application/artifact-uploads';
import { SqliteArtifactUploads } from '../infrastructure/storage/artifact-uploads';
import { HttpRemoteFiles } from '../infrastructure/http/remote-files';
import { createWorkflowPrograms } from '../capabilities/programs';
import { createCapabilities } from '../capabilities/catalog';
import { WorkflowService } from '../application/workflows';
import { SqliteWorkflowStore } from '../infrastructure/storage/workflow-store';
import { artifactResponse } from '../adapters/http/artifacts';
import { writeScopeChallenge } from '../adapters/mcp/scope-challenge';
import { DurableObject } from 'cloudflare:workers';
import OAuthProvider, { type OAuthHelpers, type OAuthResourceContext } from '@cloudflare/workers-oauth-provider';
import { CredentialService } from '../application/credentials';
import { Dispatcher } from '../application/dispatcher';
import { Registry } from '../capabilities/registry';
import type { ExecutionSelection, Grant } from '../domain/models';
import { effectiveGrant } from '../domain/token-scope';
import { ServiceError, safeError } from '../domain/errors';
import { SqliteOAuthStore } from '../infrastructure/storage/oauth-store';
import { SqliteCredentialStore } from '../infrastructure/storage/credential-store';
import { SecretBox, hash } from '../infrastructure/crypto/secret-box';
import { LarkAuthHttp } from '../infrastructure/lark/auth-http';
import { LarkHttpClient } from '../infrastructure/lark/http-client';
import { SchemaValidator } from '../infrastructure/validation/schema-validator';
import { SerialExecutor } from '../infrastructure/concurrency/serial-executor';
import { AccessSessions } from '../infrastructure/auth/access-sessions';
import { adminRoutes } from '../adapters/http/admin';
import { mcpResponse } from '../adapters/mcp/handler';
import { consentRoutes } from '../adapters/http/consent';
import { ArtifactService } from '../application/artifacts';
import { SqliteArtifactLedger } from '../infrastructure/storage/artifact-ledger';
import { PrivateR2Bucket } from '../infrastructure/storage/r2-bucket';
import { EventInbox } from './event-authority';
import { SqliteRateLimits } from '../infrastructure/storage/rate-limits';
export { EventInbox };

export interface Env {
    AUTHORITY: DurableObjectNamespace<Authority>;
    EVENT_INBOX: DurableObjectNamespace<EventInbox>;
    ARTIFACTS: R2Bucket;
    DOCS_ENGINE?: Fetcher;
    MAIL_ENGINE?: Fetcher;
    ASSETS?: Fetcher;
    PUBLIC_URL: string;
    ACCESS_TEAM_DOMAIN: string;
    ACCESS_AUD: string;
    ACCESS_EMAIL_DOMAIN: string;
    ENCRYPTION_KEY: string;
    OAUTH_KV?: KVNamespace;
    OAUTH_PROVIDER?: OAuthHelpers;
    MAX_STORAGE_BYTES: string;
    ARTIFACT_TTL_SECONDS: string;
    R2_CLASS_A_BUDGET: string;
    R2_CLASS_B_BUDGET: string;
}

export class Authority extends DurableObject<Env> {
    private readonly serial = new SerialExecutor();
    private readonly provider: OAuthProvider<Env>;
    private readonly bindings: Env;
    private readonly artifacts: ArtifactService;
    private readonly uploads: ArtifactUploadService;
    private readonly cleanupConsumers: () => Promise<unknown>;
    private readonly workflowStorage: SqliteWorkflowStore;
    private readonly rateLimits: SqliteRateLimits;
    private readonly oauthStorage: SqliteOAuthStore;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        const storage = new SqliteOAuthStore(ctx.storage.sql);
        this.oauthStorage = storage;
        this.rateLimits = new SqliteRateLimits(ctx.storage.sql);
        const credentials = new CredentialService(new SqliteCredentialStore(ctx.storage.sql), new SecretBox(env.ENCRYPTION_KEY), new LarkAuthHttp());
        const sessions = new AccessSessions({ issuer: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD, emailDomain: env.ACCESS_EMAIL_DOMAIN, origin: env.PUBLIC_URL });
        const artifactLedger = new SqliteArtifactLedger(ctx.storage.sql, {
            maxBytes: Number(env.MAX_STORAGE_BYTES), maxClassA: Number(env.R2_CLASS_A_BUDGET), maxClassB: Number(env.R2_CLASS_B_BUDGET),
        });
        const artifactBucket = new PrivateR2Bucket(env.ARTIFACTS);
        this.artifacts = new ArtifactService(artifactLedger, artifactBucket, Date.now, Number(env.ARTIFACT_TTL_SECONDS));
        this.uploads = new ArtifactUploadService(artifactLedger, artifactBucket, new SqliteArtifactUploads(ctx.storage.sql), Date.now, Number(env.ARTIFACT_TTL_SECONDS));
        Object.assign(this.artifacts, {
            beginUpload: this.uploads.beginUpload.bind(this.uploads), getUpload: this.uploads.getUpload.bind(this.uploads),
            uploadPart: this.uploads.uploadPart.bind(this.uploads), completeUpload: this.uploads.completeUpload.bind(this.uploads), abortUpload: this.uploads.abortUpload.bind(this.uploads),
        });
        const admin = adminRoutes(credentials, sessions, this.artifacts, env.EVENT_INBOX.getByName('inbox'));
        const createClient = async (selection: ExecutionSelection) => {
            const profile = await credentials.get(selection.profileId);
            return new LarkHttpClient(profile.brand, () => credentials.token(selection.profileId, selection.identity, selection.accountId));
        };
        this.workflowStorage = new SqliteWorkflowStore(ctx.storage.sql, new SecretBox(env.ENCRYPTION_KEY), new EncryptedWorkflowBlobs(this.artifacts, new SecretBox(env.ENCRYPTION_KEY)));
        const remoteFiles = new HttpRemoteFiles();
        const documentParser = new RemotePureEngine(env.DOCS_ENGINE);
        const imCardFormatter = documentParser, baseRecordFormatter = documentParser;
        const mailTransformer = new RemotePureEngine(env.MAIL_ENGINE);
        const hasher = new CloudflareContentHasher();
        const eventConsumers = new EventConsumeService(new SqliteEventConsumerStore(ctx.storage.sql, new SecretBox(env.ENCRYPTION_KEY)), env.EVENT_INBOX.getByName('inbox'), this.artifacts, documentParser, documentParser);
        this.cleanupConsumers = createEventConsumerCleanup(eventConsumers, createClient);
        storage.setGrantRevocationHook((owner) => eventConsumers.revokeOwner(owner, createClient));
        const workflows = new WorkflowService(this.workflowStorage, createWorkflowPrograms({ artifacts: this.artifacts, remoteFiles, cardFormatter: imCardFormatter, recordFormatter: baseRecordFormatter, events: env.EVENT_INBOX.getByName('inbox'), hasher, mailTransformer }), createClient);
        const registry = new Registry(createCapabilities({ eventConsumers, recordFormatter: baseRecordFormatter, mailTransformer, documentParser, remoteFiles, artifacts: this.artifacts, workflows, events: env.EVENT_INBOX.getByName('inbox') }));
        const consent = consentRoutes(credentials, sessions, storage, [...new Set(registry.list().map((item) => item.definition.domain))]);
        const dispatcher = new Dispatcher(registry, new SchemaValidator(), createClient);
        this.bindings = { ...env, OAUTH_KV: storage as unknown as KVNamespace };
        this.provider = new OAuthProvider<Env>({
            apiRoute: '/mcp',
            apiHandler: { fetch: async (request, _env, context) => {
                const authenticated = context as OAuthResourceContext<Grant>;
                const grant = effectiveGrant(authenticated.props, authenticated.auth.scope);
                const path = new URL(request.url).pathname;
                if (path === '/mcp/artifacts' || path.startsWith('/mcp/artifacts/')) return artifactResponse(request, grant, this.artifacts);
                const challenge = await writeScopeChallenge(request, authenticated.auth, registry, new SchemaValidator());
                if (challenge) return challenge;
                return mcpResponse(request, dispatcher, grant);
            } },
            defaultHandler: { fetch: (request, bindings) => {
                const path = new URL(request.url).pathname;
                return path === '/authorize' || path.startsWith('/api/admin/consent/') || path.startsWith('/api/admin/grants')
                    ? consent.fetch(request, bindings) : admin.fetch(request);
            } },
            authorizeEndpoint: '/authorize', tokenEndpoint: '/token', clientRegistrationEndpoint: '/register',
            scopesSupported: ['mcp:read', 'mcp:write', 'offline_access'], requiredScopes: ['mcp:read', 'mcp:write'],
            accessTokenTTL: 3600,
            resourceMetadata: { resource: `${env.PUBLIC_URL}/mcp`, authorization_servers: [env.PUBLIC_URL] },
        });
    }


    async fetch(request: Request): Promise<Response> {
        return this.serial.run(async () => {
            try {
                if (new URL(request.url).pathname === '/register' && request.method === 'POST') {
                    this.rateLimits.consume(await hash(request.headers.get('CF-Connecting-IP') ?? 'local'));
                }
                if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 3600_000);
                if (new URL(request.url).pathname === '/revoke') {
                    const target = new URL(request.url); target.pathname = '/token';
                    request = new Request(target, request);
                }
                return await this.provider.fetch(request, this.bindings, this.ctx as unknown as ExecutionContext);
            } catch (error) {
                return Response.json(safeError(error), { status: error instanceof ServiceError ? error.status : 500 });
            }
        });
    }

    async alarm() {
        await this.serial.run(async () => {
            const count = await this.artifacts.cleanup();
            await this.uploads.cleanup();
            await this.cleanupConsumers();
            const workflows = await this.workflowStorage.cleanup(Date.now());
            this.oauthStorage.purgeExpired();
            await this.oauthStorage.drainGrantRevocations(1);
            this.rateLimits.cleanup();
            await this.ctx.storage.setAlarm(Date.now() + (count === 100 || workflows === 100 ? 1000 : 3600_000));
        });
    }
}


export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        try {
            if (!env.PUBLIC_URL || new URL(request.url).origin !== env.PUBLIC_URL) return new Response('Invalid service origin.', { status: 400 });
            const path = new URL(request.url).pathname;
            if (path === '/api/internal/namespace-migration') return new Response('Not found.', { status: 404 });
            if (/^\/callbacks\/lark\/[a-f0-9-]{36}$/u.test(path)) return await env.EVENT_INBOX.getByName('inbox').fetch(request);
            if (!path.startsWith('/mcp/') && !path.startsWith('/api/') && !path.startsWith('/.well-known/') && !['/mcp', '/authorize', '/token', '/register', '/revoke'].includes(path)) {
                if (!env.ASSETS) return new Response('Not found.', { status: 404 });
                const asset = await env.ASSETS.fetch(request);
                const response = new Response(asset.body, asset);
                response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
                response.headers.set('Referrer-Policy', 'no-referrer');
                response.headers.set('X-Content-Type-Options', 'nosniff');
                return response;
            }
            return await env.AUTHORITY.getByName('owner').fetch(request);
        } catch (error) {
            return Response.json(safeError(error), { status: error instanceof ServiceError ? error.status : 500, headers: { 'Cache-Control': 'no-store' } });
        }
    },
};
