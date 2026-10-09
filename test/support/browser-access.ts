import { createPrivateKey, createSign } from 'node:crypto';
import keys from './access-test-key.json' with { type: 'json' };
import { accessAudience } from './access-fixture';

export function browserAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'access-test-key' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
        iss: 'http://localhost:8789', aud: accessAudience, sub: 'browser-fixture',
        email: 'browser@example.com', iat: now, exp: now + 3600,
    })).toString('base64url');
    const input = header + '.' + payload;
    const signer = createSign('RSA-SHA256');
    signer.update(input);
    return input + '.' + Buffer.from(signer.sign(createPrivateKey({ key: keys.privateKey, format: 'jwk' }))).toString('base64url');
}
