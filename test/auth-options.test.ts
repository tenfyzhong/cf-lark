import { expect, it } from 'vitest';
import { parseLarkAuthOptions } from '../src/infrastructure/lark/auth-options';

it('preserves existing legacy authentication unless explicitly configured', () => {
    expect(parseLarkAuthOptions({})).toEqual({ protocol: 'legacy', dpopMode: 'disabled' });
    expect(parseLarkAuthOptions({ LARK_OAUTH_PROTOCOL: 'oauthv3' })).toEqual({ protocol: 'oauthv3', dpopMode: 'disabled' });
});

it('accepts explicit OAuth v3 proof modes', () => {
    for (const dpopMode of ['disabled', 'preferred', 'required']) expect(parseLarkAuthOptions({ LARK_OAUTH_PROTOCOL: 'oauthv3', LARK_DPOP_MODE: dpopMode })).toEqual({ protocol: 'oauthv3', dpopMode });
});

it('fails closed on configuration errors without echoing values', () => {
    for (const env of [{ LARK_OAUTH_PROTOCOL: 'secret-value' }, { LARK_DPOP_MODE: 'secret-value' }, { LARK_DPOP_MODE: 'preferred' }, { LARK_OAUTH_PROTOCOL: 'legacy', LARK_DPOP_MODE: 'required' }]) {
        expect(() => parseLarkAuthOptions(env)).toThrow();
        try { parseLarkAuthOptions(env); } catch (error) { expect(String(error)).not.toContain('secret-value'); }
    }
});
