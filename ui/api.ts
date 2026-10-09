let csrf = '';
export function setCsrf(value: string) { csrf = value; }
export async function api<T = Record<string, unknown>>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(`/api/admin${path}`, {
        method, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let result: T & { error?: { message?: string }; message?: string };
    try {
        result = await response.json();
    } catch {
        throw new Error(`The service returned an unexpected response (HTTP ${response.status}). Please try again or contact the administrator.`);
    }
    if (!response.ok) throw new Error(result.error?.message ?? result.message ?? `Request failed (${response.status}).`);
    return result;
}
