import type { OAuthOptions } from '../../ports/credentials';
import { parseOAuthOptions } from './dpop';

/** Deployment opt-in only; reading options never creates keys or changes grants. */
export function parseLarkAuthOptions(env: { LARK_OAUTH_PROTOCOL?: string; LARK_DPOP_MODE?: string }): OAuthOptions {
    return parseOAuthOptions(env.LARK_OAUTH_PROTOCOL, env.LARK_DPOP_MODE);
}
