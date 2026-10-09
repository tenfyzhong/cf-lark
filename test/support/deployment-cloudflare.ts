/** Preload for deployment CLI subprocess tests: no real network or credentials. */
const hostname = 'mcp.acme.test', account = 'a'.repeat(32);
const application = { id: 'app-id', aud: 'b'.repeat(64), name: 'cf-lark-management', type: 'self_hosted',
    domain: hostname + '/api/admin', destinations: ['/api/admin', '/consent'].map((path) => ({ type: 'public', uri: hostname + path })),
    allowed_idps: ['pin-id'], session_duration: '8h', allow_authenticate_via_warp: false };
globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input)), path = url.pathname;
    if (url.hostname !== 'api.cloudflare.com' || init?.method !== 'GET') throw new Error('Unexpected CLI fixture request');
    let result: unknown;
    if (path === '/client/v4/zones') result = url.searchParams.get('name') === 'acme.test' ? [{ status: 'active', account: { id: account } }] : [];
    else if (path.endsWith('/workers/domains')) result = [{ hostname, service: 'cf-lark', environment: 'production' }];
    else if (path.endsWith('/workers/scripts/cf-lark/settings')) result = { bindings: [
        { name: 'PUBLIC_URL', type: 'plain_text', text: 'https://' + hostname },
        { name: 'AUTHORITY', type: 'durable_object_namespace', class_name: 'Authority', namespace_id: 'c'.repeat(32) },
        { name: 'EVENT_INBOX', type: 'durable_object_namespace', class_name: 'EventInbox', namespace_id: 'd'.repeat(32) },
        { name: 'DOCS_ENGINE', type: 'service', service: 'cf-lark-docs-engine' },
        { name: 'MAIL_ENGINE', type: 'service', service: 'cf-lark-mail-engine' },
        { name: 'ARTIFACTS', type: 'r2_bucket', bucket_name: 'cf-lark-private' },
    ] };
    else if (path.endsWith('/access/organizations')) result = { auth_domain: 'acme.cloudflareaccess.com' };
    else if (path.endsWith('/access/identity_providers')) result = [{ id: 'pin-id', type: 'onetimepin' }];
    else if (path.endsWith('/access/apps')) result = [application];
    else if (path.endsWith('/access/apps/app-id')) result = application;
    else if (path.endsWith('/access/apps/app-id/policies')) result = [{ decision: 'allow', include: [{ email_domain: { domain: 'acme.test' } }], require: [], exclude: [] }];
    else throw new Error('Unexpected CLI fixture endpoint');
    return Response.json({ success: true, result });
}) as typeof fetch;
