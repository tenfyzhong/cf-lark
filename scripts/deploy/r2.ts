import { isDeepStrictEqual } from 'node:util';

interface Provisioning { accountId: string; bucketName: string; token: string }
type Request = (url: string, init: RequestInit) => Promise<Response>;
type Rule = Record<string, unknown>;
export const retentionRule = {
    id: 'cf-lark-temporary-retention', enabled: true, conditions: { prefix: '' },
    deleteObjectsTransition: { condition: { type: 'Age', maxAge: 86400 } },
    abortMultipartUploadsTransition: { condition: { type: 'Age', maxAge: 86400 } },
};

export async function provisionR2(input: Provisioning, request: Request = fetch): Promise<void> {
    if (!/^[a-f0-9]{32}$/u.test(input.accountId)
        || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(input.bucketName) || !input.token.trim()) {
        throw new Error('Invalid R2 provisioning configuration');
    }
    const base = `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/r2/buckets`;
    const bucket = `${base}/${input.bucketName}`;
    const send = async (url: string, method: string, operation: string, body?: unknown) => {
        try {
            return await request(url, { method, headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json' },
                body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30000) });
        } catch { throw new Error(`R2 ${operation} failed`); }
    };
    const result = async (response: Response, operation: string): Promise<unknown> => {
        try {
            if (!response.ok) throw new Error();
            const envelope = await response.json() as { success?: boolean; result?: unknown };
            if (envelope.success !== true) throw new Error();
            return envelope.result;
        } catch { throw new Error(`R2 ${operation} failed`); }
    };
    const existing = await send(bucket, 'GET', 'bucket lookup');
    if (existing.status === 404) {
        const created = await send(base, 'POST', 'bucket creation', { name: input.bucketName, storageClass: 'Standard' });
        if (created.status === 400 || created.status === 409) {
            const raced = await send(bucket, 'GET', 'bucket creation');
            await result(raced, 'bucket creation');
        } else await result(created, 'bucket creation');
    } else await result(existing, 'bucket lookup');

    const lifecycleUrl = bucket + '/lifecycle';
    const lifecycle = await result(await send(lifecycleUrl, 'GET', 'lifecycle lookup'), 'lifecycle lookup') as { rules?: Rule[] } | null;
    if (!lifecycle || !Array.isArray(lifecycle.rules)
        || lifecycle.rules.some((rule) => !rule || typeof rule !== 'object' || typeof rule.id !== 'string')) {
        throw new Error('R2 lifecycle lookup failed');
    }
    const managed = lifecycle.rules.filter((rule) => rule.id === retentionRule.id);
    if (managed.length === 1 && isDeepStrictEqual(managed[0], retentionRule)) return;
    const rules = [...lifecycle.rules.filter((rule) => rule.id !== retentionRule.id), retentionRule];
    await result(await send(lifecycleUrl, 'PUT', 'lifecycle update', { rules }), 'lifecycle update');
}
