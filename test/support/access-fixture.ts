import { importJWK, SignJWT } from 'jose';
import keys from './access-test-key.json' with { type: 'json' };

export const accessIssuer = 'https://fixture.cloudflareaccess.com';
export const accessAudience = 'fixture-application-audience';
export const accessJwks = { keys: [keys.publicKey] };

export async function accessToken(claims: Record<string, unknown> = {}, issuer = accessIssuer) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ sub: 'fixture-user', email: 'admin@tenfy.cn', iat: now, exp: now + 3600, ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'access-test-key' }).setIssuer(issuer).setAudience(accessAudience)
        .sign(await importJWK(keys.privateKey, 'RS256'));
}
