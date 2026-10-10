import { calculateJwkThumbprint, compactVerify, exportJWK, generateKeyPair, importJWK, SignJWT } from 'jose';
import { ServiceError } from '../../domain/errors';
import type { AccessAuthorization, DpopKey, OAuthOptions } from '../../ports/credentials';

export function parseOAuthOptions(protocol: unknown = 'legacy', dpopMode: unknown = 'disabled'): OAuthOptions {
    if ((protocol !== 'legacy' && protocol !== 'oauthv3') || !['disabled', 'preferred', 'required'].includes(String(dpopMode))
        || (protocol === 'legacy' && dpopMode !== 'disabled')) {
        throw new ServiceError('INVALID_AUTH_CONFIGURATION', 'Select legacy/disabled or OAuth v3 with disabled, preferred, or required DPoP.', 500);
    }
    return { protocol, dpopMode: dpopMode as OAuthOptions['dpopMode'] };
}

export async function generateDpopKey(): Promise<DpopKey> {
    try {
        const { privateKey } = await generateKeyPair('ES256', { extractable: true });
        const jwk = await exportJWK(privateKey);
        return { privateJwk: JSON.stringify(jwk), jkt: await calculateJwkThumbprint(jwk, 'sha256') };
    } catch { throw new ServiceError('DPOP_KEY_UNAVAILABLE', 'A cloud proof key could not be created.', 503); }
}

function normalizeHtu(raw: string): string {
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:' || url.username || url.password || /%(?![\da-f]{2})/iu.test(url.pathname)) throw new Error();
        const path = url.pathname.replace(/%[\da-f]{2}/giu, (encoded) => {
            const decoded = String.fromCharCode(parseInt(encoded.slice(1), 16));
            return /[a-z\d._~-]/iu.test(decoded) ? decoded : encoded.toUpperCase();
        });
        return new URL(url.origin + path).toString();
    } catch { throw new ServiceError('DPOP_PROOF_FAILED', 'The proof target is invalid.', 500); }
}

export async function tokenProof(key: DpopKey | undefined, method: string, url: string, accessToken?: string): Promise<string> {
    if (!key?.privateJwk || !key.jkt) throw new ServiceError('DPOP_KEY_MISSING', 'The bound credential has no accessible proof key; authorize again.', 401);
    let jwk: { kty: string; crv: string; x: string; y: string; d: string };
    try {
        const parsed = JSON.parse(key.privateJwk);
        if (parsed.kty !== 'EC' || parsed.crv !== 'P-256' || ![parsed.x, parsed.y, parsed.d].every((v) => typeof v === 'string' && /^[\w-]{43}$/u.test(v))) throw new Error();
        jwk = { kty: 'EC', crv: 'P-256', x: parsed.x, y: parsed.y, d: parsed.d };
    } catch { throw new ServiceError('DPOP_KEY_MISSING', 'The bound credential proof key is invalid; authorize again.', 401); }
    const publicJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
    if (await calculateJwkThumbprint(publicJwk, 'sha256') !== key.jkt) {
        throw new ServiceError('DPOP_BINDING_MISMATCH', 'The credential and proof key binding do not match; authorize again.', 401);
    }
    const htu = normalizeHtu(url);
    try {
        const claims: Record<string, unknown> = { htm: method.toUpperCase(), htu };
        if (accessToken !== undefined) {
            const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken)));
            claims.ath = btoa(String.fromCharCode(...hash)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
        }
        const proof = await new SignJWT(claims).setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk })
            .setJti(crypto.randomUUID()).setIssuedAt().sign(await importJWK(jwk, 'ES256'));
        // Validate the private/public pair, not only the public thumbprint.
        await compactVerify(proof, await importJWK(publicJwk, 'ES256'));
        return proof;
    } catch { throw new ServiceError('DPOP_BINDING_MISMATCH', 'The credential proof key could not be verified; authorize again.', 401); }
}

export async function authorizationHeaders(authorization: string | AccessAuthorization, method: string, url: string): Promise<Record<string, string>> {
    if (typeof authorization === 'string') return { Authorization: `Bearer ${authorization}` };
    if (authorization.tokenType === 'DPoP') return {
        Authorization: `DPoP ${authorization.accessToken}`,
        DPoP: await tokenProof(authorization.dpopKey, method, url, authorization.accessToken),
    };
    if (authorization.tokenType !== 'Bearer' || authorization.dpopKey) {
        throw new ServiceError('DPOP_BINDING_MISMATCH', 'The credential has inconsistent proof binding metadata.', 401);
    }
    return { Authorization: `Bearer ${authorization.accessToken}` };
}
