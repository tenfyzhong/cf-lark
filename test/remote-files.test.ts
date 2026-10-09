import { describe, expect, it, vi } from 'vitest';
import { HttpRemoteFiles } from '../src/infrastructure/http/remote-files';

describe('isolated remote file transport', () => {
    it('follows validated public redirects without credentials and reads bounded bytes', async () => {
        const send = vi.fn(async (request: Request) => {
            expect(request.headers.get('Authorization')).toBeNull(); expect(request.headers.get('Cookie')).toBeNull(); expect(request.redirect).toBe('manual');
            if (request.url.includes('/start')) return Response.redirect('https://cdn.example.com/file?signature=private', 302);
            return new Response('data', { headers: { 'Content-Length': '4', 'Content-Type': 'text/plain', 'Content-Disposition': "attachment; filename*=UTF-8''report%20file.txt" } });
        });
        const files = new HttpRemoteFiles(send);
        const result = await files.read('https://files.example.com/start', 4);
        expect(result.name).toBe('report file.txt'); expect(await result.body.text()).toBe('data'); expect(result.contentType).toBe('text/plain');
        expect(send).toHaveBeenCalledTimes(2);
    });
    it.each(['http://127.0.0.1/file', 'http://0x7f000001/file', 'http://[::1]/file', 'https://localhost/file', 'https://host.internal/file',
        'https://user:secret@example.com/file', 'file:///tmp/file', 'https://example.com:444/file'])('rejects non-public URL forms before network: %s', async (url) => {
        const send = vi.fn(); await expect(new HttpRemoteFiles(send).stream(url, 10)).rejects.toMatchObject({ code: 'INVALID_REMOTE_URL' }); expect(send).not.toHaveBeenCalled();
    });
    it('rejects private redirect targets, oversized declared bodies and oversized streamed bodies', async () => {
        const send = vi.fn(async () => Response.redirect('http://169.254.169.254/latest', 302));
        await expect(new HttpRemoteFiles(send).stream('https://example.com/file', 10)).rejects.toMatchObject({ code: 'INVALID_REMOTE_URL' }); expect(send).toHaveBeenCalledTimes(1);
        await expect(new HttpRemoteFiles(async () => new Response('oversized', { headers: { 'Content-Length': '9' } })).stream('https://example.com/file', 4)).rejects.toMatchObject({ code: 'REMOTE_TOO_LARGE' });
        await expect(new HttpRemoteFiles(async () => new Response('oversized')).read('https://example.com/file', 4)).rejects.toMatchObject({ code: 'REMOTE_TOO_LARGE' });
    });
    it('streams presigned PUT with exact length, safe metadata and ETag receipt', async () => {
        const send = vi.fn(async (request: Request) => {
            expect(request.method).toBe('PUT'); expect(request.headers.get('Authorization')).toBeNull();
            expect(request.headers.get('Content-Length')).toBe('4'); expect(request.headers.get('Content-Disposition')).toBe('attachment; filename=report.txt');
            expect(await request.text()).toBe('data'); return new Response(null, { headers: { ETag: '"fixture-etag"' } });
        });
        const result = await new HttpRemoteFiles(send).put('https://example.com/upload?signature=secret', new Response('data').body!, 4,
            { contentType: 'text/plain', contentDisposition: 'attachment; filename=report.txt' });
        expect(result).toEqual({ etag: '"fixture-etag"' });
    });
    it('does not follow or retry PUT redirects and sanitizes uncertain failures', async () => {
        const send = vi.fn(async () => Response.redirect('https://other.example.com/upload', 307));
        await expect(new HttpRemoteFiles(send).put('https://example.com/upload', new Response('data').body!, 4)).rejects.toMatchObject({ code: 'REMOTE_HTTP_ERROR' });
        expect(send).toHaveBeenCalledTimes(1);
        const failed = new HttpRemoteFiles(async () => { throw new Error('https://example.com/?secret=hidden'); });
        await expect(failed.put('https://example.com/upload', new Response('data').body!, 4)).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN', message: 'The remote upload outcome could not be confirmed.' });
    });
});
