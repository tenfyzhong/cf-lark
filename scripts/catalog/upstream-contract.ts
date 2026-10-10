import { createHash } from 'node:crypto';

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return value;
}

/** A stable schema digest; array order remains significant. */
export function digestContract(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
