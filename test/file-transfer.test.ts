import { describe, expect, it, vi } from 'vitest';
import { LarkHttpClient } from '../src/infrastructure/lark/http-client';

describe('authenticated Lark file transfers', () => {
    it('uploads exact binary bytes using multipart boundaries and the selected token', async () => {
        const token = vi.fn(async () => 'fixture-token');
        const send = vi.fn(async (request: Request) => {
            expect(request.headers.get('Authorization')).toBe('Bearer fixture-token');
            expect(request.headers.get('Content-Type')).toMatch(/^multipart\/form-data; boundary=/u);
            expect(request.redirect).toBe('manual');
            const form = await request.formData();
            expect(form.get('parent_type')).toBe('explorer');
            const file = form.get('file') as File;
            expect(file.name).toBe('fixture.bin');
            expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([0, 1, 255, 42]));
            return Response.json({ code: 0, data: { file_token: 'file_fixture' } });
        });
        const client = new LarkHttpClient('feishu', token, send);
        expect(await client.upload({ path: '/open-apis/drive/v1/files/upload_all', fields: { parent_type: 'explorer' },
            file: { field: 'file', name: 'fixture.bin', body: new Blob([new Uint8Array([0, 1, 255, 42])]) } })).toEqual({ file_token: 'file_fixture' });
        expect(token).toHaveBeenCalledTimes(1);
    });
    it('preserves a binary download stream and shares the JSON request budget', async () => {
        const send = vi.fn(async (_request: Request) => new Response(new Uint8Array([255, 0, 10]), { headers: { 'Content-Length': '3', 'Content-Type': 'image/png' } }));
        const client = new LarkHttpClient('lark', async () => 'token', send, 1);
        const response = await client.download({ path: '/open-apis/drive/v1/files/file_fixture/download' });
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([255, 0, 10]));
        expect(send.mock.calls[0]![0].url).toContain('https://open.larksuite.com/');
        await expect(client.request({ method: 'GET', path: '/open-apis/drive/v1/files' })).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    });
    it('rejects invalid upload size and path before requesting credentials', async () => {
        const token = vi.fn();
        const client = new LarkHttpClient('feishu', token);
        const upload = { path: '/open-apis/drive/v1/files/upload_all', fields: {}, file: { field: 'file', name: 'file.bin', body: new Blob([]) } };
        await expect(client.upload(upload)).rejects.toMatchObject({ code: 'INVALID_FILE' });
        await expect(client.upload({ ...upload, file: { ...upload.file, body: new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]) } })).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
        await expect(client.download({ path: 'https://attacker.example/file' })).rejects.toThrow();
        expect(token).not.toHaveBeenCalled();
    });
    it('never follows redirects or retries uncertain uploads', async () => {
        const send = vi.fn(async () => { throw new Error('Connection lost'); });
        const client = new LarkHttpClient('feishu', async () => 'token', send);
        await expect(client.upload({ path: '/open-apis/im/v1/images', fields: { image_type: 'message' },
            file: { field: 'image', name: 'image.png', body: new Blob(['data']) } })).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' });
        expect(send).toHaveBeenCalledTimes(1);
        const redirect = new LarkHttpClient('feishu', async () => 'token', async () => Response.redirect('https://attacker.example', 302));
        await expect(redirect.download({ path: '/open-apis/drive/v1/files/file_fixture/download' })).rejects.toMatchObject({ code: 'UPSTREAM_HTTP_ERROR' });
    });
    it('rejects JSON error envelopes returned with HTTP success instead of saving them as files', async () => {
        const client = new LarkHttpClient('feishu', async () => 'token', async () =>
            Response.json({ code: 99991672, msg: 'Missing permissions' }));
        await expect(client.download({ path: '/open-apis/drive/v1/files/fixture/download' }))
            .rejects.toMatchObject({ code: 'UPSTREAM_ERROR', details: { upstreamCode: 99991672 } });
    });
    it('preserves legitimate JSON files including error-shaped attachments and large streams', async () => {
        for (const [body, attachment] of [
            ['{"name":"file","value":42}', false],
            ['{"code":42,"msg":"Application data"}', true],
            [JSON.stringify({ text: 'x'.repeat(100_000) }), false],
        ] as const) {
            const client = new LarkHttpClient('feishu', async () => 'token', async () => new Response(body, {
                headers: { 'Content-Type': 'application/json', ...(attachment ? { 'Content-Disposition': 'attachment; filename=data.json' } : {}) },
            }));
            expect(await (await client.download({ path: '/open-apis/drive/v1/files/fixture/download' })).text()).toBe(body);
        }
    });

});

it('downloads POST-generated binary data with an authenticated JSON body', async () => {
    const send = vi.fn(async (request: Request) => {
        expect(request.method).toBe('POST');
        expect(request.headers.get('Content-Type')).toBe('application/json');
        expect(await request.json()).toEqual({ meeting_id: 'meeting' });
        return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });
    });
    const client = new LarkHttpClient('feishu', async () => 'token', send);
    const response = await client.download({ path: '/open-apis/vc/v1/bots/screenshot', method: 'POST', body: { meeting_id: 'meeting' } });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
});

it('preserves explicit repeated and comma-separated queries without changing JSON arrays', async () => {
    const send = vi.fn(async (request: Request) => {
        const params = new URL(request.url).searchParams;
        expect(params.getAll('message_ids')).toEqual(['om_one', 'om_two']);
        expect(params.get('fields')).toBe('name,email');
        expect(params.get('filters')).toBe('["one","two"]');
        return Response.json({ data: {} });
    });
    const client = new LarkHttpClient('feishu', async () => 'token', send);
    await client.request({ method: 'GET', path: '/open-apis/im/v1/messages/mget', query: { message_ids: ['om_one', 'om_two'], fields: ['name', 'email'], filters: ['one', 'two'] },
        queryEncoding: { message_ids: 'repeat', fields: 'comma' } });
});

it('streams multipart uploads with exact bytes, fields and endpoint-specific limits', async () => {
    const send = vi.fn(async (request: Request) => {
        const form = await request.formData();
        expect(form.get('file_type')).toBe('stream');
        const file = form.get('file') as File;
        expect(file.name).toBe('report.bin');
        expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([0, 255, 42]));
        return Response.json({ data: { file_key: 'file_result' } });
    });
    const client = new LarkHttpClient('feishu', async () => 'token', send);
    expect(await client.uploadStream({ path: '/open-apis/im/v1/files', fields: { file_type: 'stream' },
        file: { field: 'file', name: 'report.bin', size: 3, body: new Response(new Uint8Array([0, 255, 42])).body! } })).toEqual({ file_key: 'file_result' });
    await expect(client.uploadStream({ path: '/open-apis/im/v1/images', fields: {},
        file: { field: 'image', name: 'image.png', size: 5 * 1024 * 1024 + 1, body: new Response('x').body! } })).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    await expect(client.uploadStream({ path: '/open-apis/task/v2/attachments/upload', fields: {},
        file: { field: 'file', name: 'large.bin', size: 50 * 1024 * 1024 + 1, body: new Response('x').body! } })).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(send).toHaveBeenCalledTimes(1);
});

it('rejects truncated streaming uploads and unsafe multipart field names', async () => {
    const send = vi.fn(async (request: Request) => { await request.arrayBuffer(); return Response.json({ data: {} }); });
    const client = new LarkHttpClient('feishu', async () => 'token', send);
    await expect(client.uploadStream({ path: '/open-apis/im/v1/files', fields: {},
        file: { field: 'file', name: 'file.bin', size: 2, body: new Response('x').body! } })).rejects.toMatchObject({ code: 'OUTCOME_UNCERTAIN' });
    await expect(client.uploadStream({ path: '/open-apis/im/v1/files', fields: { 'bad\r\nfield': 'value' },
        file: { field: 'file', name: 'file.bin', size: 1, body: new Response('x').body! } })).rejects.toMatchObject({ code: 'INVALID_FILE' });
    expect(send).toHaveBeenCalledTimes(1);
});
it.each(['POST','PUT','PATCH','DELETE'] as const)('preserves %s for streamed multipart mutations',async method=>{
 const send=vi.fn(async(request:Request)=>{expect(request.method).toBe(method);const form=await request.formData();expect(await (form.get('file') as File).text()).toBe('bytes');return Response.json({code:0,data:{ok:true}});});
 const client=new LarkHttpClient('feishu',async()=> 'token',send);
 expect(await client.uploadStream({method,path:'/open-apis/example/v1/files',fields:{},file:{field:'file',name:'data.txt',size:5,body:new Blob(['bytes']).stream()}})).toEqual({ok:true});
});
it.each(['PUT','PATCH','DELETE'] as const)('preserves %s JSON bodies when downloading binary responses',async method=>{
 const send=vi.fn(async(request:Request)=>{expect(request.method).toBe(method);expect(await request.json()).toEqual({id:'x'});return new Response('binary');});
 const client=new LarkHttpClient('lark',async()=> 'token',send);
 expect(await(await client.download({method,path:'/open-apis/example/v1/export',body:{id:'x'}})).text()).toBe('binary');
});
