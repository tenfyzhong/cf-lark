import { ServiceError } from '../../domain/errors';
import type { Brand } from '../../domain/models';

interface Classification { type: string; subtype: string; action: string; message: string; transient?: boolean }
const classifications: Readonly<Record<number, Classification>> = {
    99991672: { type: 'authorization', subtype: 'app_scope_missing', action: 'enable_app_scope', message: 'Ask the application administrator to enable and publish the required application scope.' },
    99991676: { type: 'authorization', subtype: 'token_scope_missing', action: 'check_token_permissions', message: 'Check the selected token identity and its permissions. Application permissions and user consent are separate.' },
    99991679: { type: 'authorization', subtype: 'user_scope_missing', action: 'renew_user_consent', message: 'Authorize the selected user account with the required scopes after verifying the application scopes.' },
    99991677: { type: 'authentication', subtype: 'token_expired', action: 'renew_authorization', message: 'The user token expired. Renew authorization before retrying.' },
    99991668: { type: 'authentication', subtype: 'token_invalid', action: 'check_authorization', message: 'The token is invalid or unsupported for this API. Check identity and renew authorization if needed.' },
    99991663: { type: 'authentication', subtype: 'token_invalid', action: 'check_authorization', message: 'The token is invalid or unsupported for this API. Check identity and renew authorization if needed.' },
    99991661: { type: 'authentication', subtype: 'token_missing', action: 'check_authorization', message: 'The upstream API did not receive an access token.' },
    99991671: { type: 'authentication', subtype: 'token_invalid', action: 'check_authorization', message: 'The upstream API rejected the token format.' },
    99991669: { type: 'authentication', subtype: 'refresh_token_invalid', action: 'renew_user_consent', message: 'The refresh token is invalid. Authorize the selected account again.' },
    99991400: { type: 'rate_limit', subtype: 'rate_limited', action: 'wait_before_retry', message: 'Wait before another request. Check a write outcome before attempting the write again.', transient: true },
};

function object(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function logId(value: unknown): string | undefined {
    // Provider correlation IDs only: do not echo arbitrary headers, tokens, or URLs.
    return typeof value === 'string' && /^(?:\d{8,20}-[a-fA-F0-9]{8,32}|\d{14}[a-zA-Z0-9]{8,64})$/u.test(value) ? value : undefined;
}

function retryAfter(value: string | null, now: number): number | undefined {
    if (value === null) return undefined;
    let seconds: number;
    if (/^(?:0|[1-9]\d{0,5})$/u.test(value)) seconds = Number(value);
    else if (/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/u.test(value)) seconds = Math.max(0, Math.ceil((Date.parse(value) - now) / 1000));
    else return undefined;
    return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 86_400 ? seconds : undefined;
}

function legacyReason(code: number | undefined, message: unknown): string | undefined {
    const text = typeof message === 'string' ? message.toLowerCase() : '';
    return text.includes('command already exists') ? 'command_already_exists'
        : code === 2 && text.includes('member_type') ? 'unsupported_member_type'
        : text.includes('server time out error') || text.includes('data not ready') ? 'transient_tool_failure'
        : text.includes('k_dl_1600039') && text.includes('lock already held') ? 'dts_lock_contention' : undefined;
}

/** Build exclusively allowlisted metadata; no upstream message or URL is returned. */
export function upstreamError(input: { brand: Brand; method: string; response: Response; body?: unknown; now?: number }): ServiceError {
    const body = object(input.body), nested = object(body?.error);
    const code = typeof body?.code === 'number' && Number.isSafeInteger(body.code) ? body.code : undefined;
    const status = input.response.status;
    const classification = (code === undefined ? undefined : classifications[code])
        ?? (status === 429 ? classifications[99991400]!
            : status === 401 ? { type: 'authentication', subtype: 'authentication_failed', action: 'check_authorization', message: 'Check the selected identity and its current authorization.' }
                : status === 403 ? { type: 'authorization', subtype: 'access_denied', action: 'check_access', message: 'Check resource access, application permissions, and user consent. This status alone does not identify which permission is missing.' }
                    : { type: 'upstream', subtype: status >= 500 ? 'service_unavailable' : 'operation_rejected', action: 'check_provider_error', message: 'Check the provider error code and correlation ID. Verify a write outcome before repeating it.', transient: status >= 500 });
    const log = logId(input.response.headers.get('x-tt-logid')) ?? logId(input.response.headers.get('x-lark-request-id'))
        ?? logId(nested?.log_id) ?? logId(body?.log_id);
    const retry = classification.type === 'rate_limit' || classification.transient
        ? retryAfter(input.response.headers.get('retry-after'), input.now ?? Date.now()) : undefined;
    // Legacy workflow fallbacks were only enabled by successful HTTP API-error envelopes.
    // Do not let HTTP errors or malformed codes enable write retries or alternate writes.
    const reason = input.response.ok && code !== undefined && code !== 0 ? legacyReason(code, body?.msg) : undefined;
    return new ServiceError(input.response.ok ? 'UPSTREAM_ERROR' : 'UPSTREAM_HTTP_ERROR',
        'The upstream API rejected the operation.', 502, {
            ...(!input.response.ok ? { upstreamStatus: status } : {}), ...(code === undefined ? {} : { upstreamCode: code }),
            type: classification.type, subtype: classification.subtype,
            ...(classification.subtype.endsWith('_scope_missing') ? { scope_details: 'unavailable' } : {}),
            retryable: input.method === 'GET' && Boolean(classification.transient),
            troubleshooter: { action: classification.action, message: classification.message,
                url: `https://${input.brand === 'lark' ? 'open.larksuite.com' : 'open.feishu.cn'}/document/server-docs/api-call-guide/generic-error-code` },
            ...(log ? { log_id: log } : {}), ...(retry === undefined ? {} : { retry_after_seconds: retry, retry_after: retry }), ...(reason ? { reason } : {}),
        });
}

/** Limit error-body inspection, including responses without a Content-Length. */
export async function readErrorBody(response: Response): Promise<unknown> {
    const reader = response.body?.getReader();
    if (!reader) return undefined;
    const chunks: Uint8Array[] = []; let size = 0;
    try {
        while (true) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.byteLength;
            if (size > 64 * 1024) { void reader.cancel().catch(() => {}); return undefined; }
            chunks.push(next.value);
        }
        return JSON.parse(await new Blob(chunks as BlobPart[]).text());
    } catch { return undefined; }
}
