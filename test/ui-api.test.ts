import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../ui/api';

afterEach(() => vi.unstubAllGlobals());

it('reports HTML error pages without exposing response markup or JSON parser errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!DOCTYPE html><title>Private proxy details</title>', { status: 500, headers: { 'Content-Type': 'text/html' } })));
    await expect(api('/session')).rejects.toThrow('The service returned an unexpected response (HTTP 500). Please try again or contact the administrator.');
});

it('preserves structured API errors and successful JSON data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: 'Management login is required.' }, { status: 401 })));
    await expect(api('/session')).rejects.toThrow('Management login is required.');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ csrf: 'fixture' })));
    expect(await api('/session')).toEqual({ csrf: 'fixture' });
});
