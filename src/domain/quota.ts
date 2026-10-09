import { ServiceError } from './errors';

export const DEFAULT_QUOTA = Object.freeze({
    storageBytes: 2_000_000_000,
    retentionSeconds: 86_400,
    classA: 100_000,
    classB: 1_000_000,
});

export function reserveStorage(used: number, requested: number, limit = DEFAULT_QUOTA.storageBytes): number {
    if (!Number.isSafeInteger(used) || used < 0 || !Number.isSafeInteger(requested) || requested <= 0) {
        throw new ServiceError('INVALID_SIZE', 'Artifact size must be a positive safe integer.');
    }
    if (requested > limit - used) {
        throw new ServiceError('STORAGE_QUOTA_EXCEEDED', 'Temporary storage capacity is exhausted.', 429);
    }
    return used + requested;
}

export function consumeOperation(used: number, kind: 'A' | 'B'): number {
    const limit = kind === 'A' ? DEFAULT_QUOTA.classA : DEFAULT_QUOTA.classB;
    if (!Number.isSafeInteger(used) || used < 0 || used >= limit) {
        throw new ServiceError('OPERATION_QUOTA_EXCEEDED', 'The monthly storage operation budget is exhausted.', 429);
    }
    return used + 1;
}
