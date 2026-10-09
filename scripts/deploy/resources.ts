import { CloudflareBootstrapClient } from './cloudflare.ts';

type Binding = Record<string, unknown>;
function workerName(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,50}$/u.test(value)) throw new Error('Invalid discovered Worker name');
    return value;
}
function existingBucket(result: unknown, worker: string, origin: string): string {
    const bindings = (result as { bindings?: unknown } | null)?.bindings;
    if (!Array.isArray(bindings) || bindings.some((item) => !item || typeof item !== 'object')) throw new Error('Invalid existing Worker bindings');
    const binding = (name: string, type: string): Binding => {
        const matches = bindings.filter((item: Binding) => item.name === name);
        if (matches.length !== 1 || matches[0].type !== type) throw new Error('Existing Worker is not a compatible cf-lark installation');
        return matches[0];
    };
    const publicUrl = binding('PUBLIC_URL', 'plain_text').text;
    if (typeof publicUrl !== 'string' || publicUrl.replace(/\/$/u, '') !== origin) throw new Error('Worker belongs to another origin; choose a distinct WORKER_NAME');
    for (const [name, className] of [['AUTHORITY', 'Authority'], ['EVENT_INBOX', 'EventInbox']]) {
        const entry = binding(name!, 'durable_object_namespace');
        if (entry.class_name !== className || typeof entry.namespace_id !== 'string' || !entry.namespace_id) {
            throw new Error('Incompatible existing Durable Object identity');
        }
    }
    for (const [name, suffix] of [['DOCS_ENGINE', 'docs'], ['MAIL_ENGINE', 'mail']]) {
        const entry = binding(name!, 'service');
        if (entry.service !== `${worker}-${suffix}-engine` || (entry.environment && entry.environment !== 'production')) {
            throw new Error('Incompatible existing private engine identity');
        }
    }
    const bucket = binding('ARTIFACTS', 'r2_bucket');
    if (typeof bucket.bucket_name !== 'string' || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(bucket.bucket_name) || bucket.jurisdiction) {
        throw new Error('Invalid existing private R2 binding');
    }
    return bucket.bucket_name;
}

/** Retain deployed resource identities; never infer a replacement for missing storage. */
export async function discoverResources(client: CloudflareBootstrapClient, account: string, origin: string, selectedName?: string): Promise<{ worker: string; bucket: string }> {
    const hostname = new URL(origin).hostname;
    const base = `/accounts/${account}/workers`;
    const domains = (await client.list(`${base}/domains?hostname=${encodeURIComponent(hostname)}`)).filter((domain) => domain.hostname === hostname);
    if (domains.length > 1) throw new Error('Ambiguous existing Worker domain binding');
    const domain = domains[0];
    if (domain && domain.environment && domain.environment !== 'production') throw new Error('Unsupported Worker domain environment');
    const worker = workerName(domain ? domain.service : selectedName || 'cf-lark');
    if (domain && selectedName && selectedName !== worker) throw new Error('WORKER_NAME does not match the existing hostname binding');
    const settings = await client.call(`${base}/scripts/${worker}/settings`, 'GET', undefined, true);
    if (!settings) {
        if (domain) throw new Error('Existing domain Worker settings could not be found');
        return { worker, bucket: `${worker}-private` };
    }
    return { worker, bucket: existingBucket(settings.result, worker, origin) };
}
