import { expect, it, vi } from 'vitest';
import { saveDownloadResponse } from '../src/capabilities/files/index';
import { fixtureFiles } from './support/file-workflow-fixtures';
import type { CommandContext } from '../src/ports/capabilities';
const context: CommandContext = { lark: { request: vi.fn() }, selection: { profileId: 'p', identity: 'bot' },
    grant: { id: 'download-owner', expiresAt: Date.now() + 60_000, revoked: false, domains: ['artifact'], permissions: ['write'],
        profiles: [{ profileId: 'p', accounts: [], identities: ['bot'] }] } };
it('saves known and unknown length downloads as grant-owned artifact receipts', async () => {
    for (const headers of [{}, { 'Content-Length': '4' }] as Record<string, string>[] ) {
        const output = await saveDownloadResponse(fixtureFiles, context, new Response('data', { headers }), 'report.txt');
        expect(output).toMatchObject({ size_bytes: 4, filename: 'report.txt', download_path: `/mcp/artifacts/${output.artifact_id}` });
        expect(await (await fixtureFiles.read(context.grant.id, output.artifact_id)).text()).toBe('data');
    }
});
it('requires artifact write consent before saving downloaded bytes', async () => {
    const upload = vi.fn();
    await expect(saveDownloadResponse({ ...fixtureFiles, upload }, { ...context, grant: { ...context.grant, domains: ['docs'] } }, new Response('data'), 'report.txt'))
        .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(upload).not.toHaveBeenCalled();
});
