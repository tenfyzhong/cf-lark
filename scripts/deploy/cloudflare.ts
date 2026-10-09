export type CloudflareRequest = (url: string, init: RequestInit) => Promise<Response>;
type Envelope = { success: boolean; result: unknown; result_info?: { total_pages?: number } };

/** Deployment-only client. Never include upstream responses in errors or logs. */
export class CloudflareBootstrapClient {
    private token: string;
    private request: CloudflareRequest;
    constructor(token: string, request: CloudflareRequest = fetch) {
        this.token = token;
        this.request = request;
    }

    async call(path: string, method = 'GET', body?: unknown, missingAllowed = false): Promise<Envelope | null> {
        try {
            const response = await this.request(`https://api.cloudflare.com/client/v4${path}`, {
                method, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
                redirect: 'error', signal: AbortSignal.timeout(30_000),
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            if (missingAllowed && response.status === 404) return null;
            if (!response.ok) throw new Error();
            const envelope = await response.json() as Envelope;
            if (envelope?.success !== true || !('result' in envelope)) throw new Error();
            return envelope;
        } catch { throw new Error('Cloudflare bootstrap request failed'); }
    }

    async list(path: string): Promise<Record<string, unknown>[]> {
        const results: Record<string, unknown>[] = [];
        for (let page = 1; page <= 20; page++) {
            const url = new URL(path, 'https://api.cloudflare.com');
            url.searchParams.set('page', String(page));
            url.searchParams.set('per_page', '50');
            const envelope = await this.call(url.pathname + url.search);
            if (!Array.isArray(envelope?.result) || envelope.result.some((item) => !item || typeof item !== 'object')) {
                throw new Error('Invalid Cloudflare bootstrap inventory');
            }
            results.push(...envelope.result);
            const total = envelope.result_info?.total_pages ?? (envelope.result.length < 50 ? page : page + 1);
            if (!Number.isInteger(total) || total < 0) throw new Error('Invalid Cloudflare bootstrap pagination');
            if (page >= total) return results;
        }
        throw new Error('Cloudflare bootstrap inventory exceeds limit');
    }
}
