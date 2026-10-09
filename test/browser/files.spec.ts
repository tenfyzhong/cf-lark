import { test, expect } from '@playwright/test';

for (const command of ['drive.+upload', 'docs.+media-upload']) {
    test(`native Worker file workflow: ${command}`, async ({ request }) => {
        let id = 0;
        const call = async (command: string, args: Record<string, unknown>, dryRun = false) => {
            const response = await request.post('http://localhost:8788/mcp', { headers: { Accept: 'application/json, text/event-stream' },
                data: { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'lark_execute', arguments: { command, args, identity: 'user', dryRun } } } });
            const body = await response.json();
            expect(body.result.isError, JSON.stringify(body)).not.toBe(true);
            return { data: body.result.structuredContent.data, headers: response.headers() };
        };
        const content = 'AAH+/w==';
        const artifact = await call('artifact.upload', { content });
        expect(artifact.headers['x-fixture-requests']).toBe('0');
        expect((await call('artifact.read', { id: artifact.data.id })).data.content).toBe(content);
        const args = { file: artifact.data.id, name: 'fixture.bin', ...(command.startsWith('docs') ? { 'parent-type': 'docx_file', 'parent-node': 'block' } : {}) };
        expect((await call(command, args, true)).headers['x-fixture-requests']).toBe('0');
        let step = await call(command, args);
        let uploaded = false;
        for (let i = 0; i < 8 && step.data.status === 'pending'; i++) {
            step = await call('workflow.resume', { id: step.data.workflowId });
            expect(Number(step.headers['x-fixture-requests'])).toBeLessThanOrEqual(1);
            if (step.headers['x-fixture-upload']) { expect(step.headers['x-fixture-upload']).toBe(content); uploaded = true; }
        }
        expect(uploaded).toBe(true);
        expect(step.data).toMatchObject({ status: 'completed', output: { file_token: 'fixture-upload', size: 4 } });
        const replay = await call('workflow.resume', { id: step.data.workflowId });
        expect(replay.headers['x-fixture-requests']).toBe('0');
        await call('artifact.delete', { id: artifact.data.id });
    });
}
