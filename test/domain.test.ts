import { describe, expect, it } from 'vitest';
import { authorize } from '../src/domain/authorization';
import { reserveStorage, consumeOperation, DEFAULT_QUOTA } from '../src/domain/quota';
import { validateApiPath } from '../src/domain/upstream';

describe('grant authorization', () => {
    const grant = {
        id: 'grant-1', expiresAt: 2000, revoked: false,
        profiles: [{ profileId: 'app-1', accounts: ['account-1'], identities: ['user', 'bot'] as const }],
        domains: ['calendar'], permissions: ['read'] as const,
    };
    const call = { profileId: 'app-1', accountId: 'account-1', identity: 'user' as const, domain: 'calendar', risk: 'read' as const };

    it('allows an explicitly authorized identity and domain', () => {
        expect(() => authorize(grant, call, 1000)).not.toThrow();
    });
    it.each([
        { profileId: 'another-app' }, { accountId: 'another-account' },
        { accountId: undefined }, { domain: 'mail' }, { risk: 'write' },
    ])('rejects unauthorized context %j', (change) => {
        expect(() => authorize(grant, { ...call, ...change } as typeof call, 1000)).toThrow();
    });
    it('rejects expired and revoked grants', () => {
        expect(() => authorize(grant, call, 2000)).toThrow();
        expect(() => authorize({ ...grant, revoked: true }, call, 1000)).toThrow();
    });
    it('does not require a user account for authorized bot calls', () => {
        expect(() => authorize(grant, { ...call, accountId: undefined, identity: 'bot' }, 1000)).not.toThrow();
    });
});

describe('artifact quota policy', () => {
    it('reserves up to exactly two decimal gigabytes', () => {
        expect(DEFAULT_QUOTA.storageBytes).toBe(2_000_000_000);
        expect(reserveStorage(1_999_999_990, 10)).toBe(2_000_000_000);
        expect(() => reserveStorage(1_999_999_990, 11)).toThrow();
    });
    it.each([-1, 0, 1.1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid size %s', (size) => {
        expect(() => reserveStorage(0, size)).toThrow();
    });
    it('accounts for the attempt before external execution', () => {
        expect(consumeOperation(99_999, 'A')).toBe(100_000);
        expect(() => consumeOperation(100_000, 'A')).toThrow();
        expect(() => consumeOperation(1_000_000, 'B')).toThrow();
    });
});

describe('authenticated upstream paths', () => {
    it('accepts official API paths', () => {
        expect(validateApiPath('/open-apis/calendar/v4/calendars')).toBe('/open-apis/calendar/v4/calendars');
    });
    it.each([
        'https://evil.example/open-apis/im', '//evil.example', '/open-apis/../oauth',
        '/open-apis/%2e%2e/oauth', '/open-apis/%252e%252e/oauth',
        '/open-apis/a?token=x', '/open-apis/a#x', '/open-apis/a\\b',
    ])('rejects unsafe path %s', (path) => {
        expect(() => validateApiPath(path)).toThrow();
    });
});
