import { describe, it, expect, vi } from 'vitest';
import { docsScriptCapability } from '../src/capabilities/docs/script';
import type { CommandContext } from '../src/ports/capabilities';
import type { ArtifactFiles } from '../src/ports/artifacts';
const profile = {
    word_count: 2,
    char_count: 10,
    breakdown: {},
    block_count: 1,
    blocks: [{ type: 'p', count: 1, ratio: 1 }],
};
const parser = { parse: vi.fn(async () => profile) };
const files: ArtifactFiles = {
    stat: vi.fn(async (owner, id) => ({
        owner,
        id,
        size: 2,
        state: 'ready' as const,
        expiresAt: 9999999999999,
    })),
    read: vi.fn(async () => new Response('{}')),
    upload: vi.fn(async (owner, size) => ({
        owner,
        size,
        id: 'workspace',
        state: 'ready' as const,
        expiresAt: 1,
    })),
    remove: vi.fn(),
};
const context = () =>
    ({
        selection: { profileId: 'p', identity: 'bot' },
        grant: {
            id: 'g',
            revoked: false,
            expiresAt: Date.now() + 100000,
            profiles: [{ profileId: 'p', identities: ['bot'], accounts: [] }],
            domains: ['docs', 'artifact'],
            permissions: ['read', 'write'],
        },
        lark: {
            request: vi.fn().mockResolvedValue({
                document: { content: '<p>Hello world</p>' },
            }),
        },
    }) as unknown as CommandContext;
const command = () => docsScriptCapability(files, parser);
describe('hosted document script', () => {
    it('creates a private decision workspace without a draft XML file', async () => {
        const c = context();
        expect(
            await command().execute(
                { command: 'init-draft', 'presentation-decision': '{}' },
                c,
            ),
        ).toMatchObject({ workspace: 'workspace', draft_created: false });
        expect(c.lark.request).not.toHaveBeenCalled();
    });
    it('projects parser output and evaluates word and block constraints', async () => {
        const result = await command().execute(
            {
                command: 'parse',
                content: '<p>Hello world</p>',
                'presentation-decision':
                    '{"word_count":{"min":3,"max":null},"visual_plan":{"blocks":[{"type":"table","min_count":1}]}}',
            },
            context(),
        );
        expect(result).toMatchObject({
            assessment: { status: 'failed' },
            profile: { word_count: 2 },
            diagnostics: [
                { code: 'word_count_out_of_range', actual: 2 },
                { code: 'required_block_missing', actual: 0 },
            ],
        });
        expect((result as { profile: unknown }).profile).not.toHaveProperty(
            'breakdown',
        );
    });
    it('fetches online XML and reuses the workspace decision', async () => {
        const c = context();
        expect(
            await command().execute(
                {
                    command: 'parse',
                    doc: 'https://x/wiki/doc',
                    workspace: 'workspace',
                },
                c,
            ),
        ).toMatchObject({ assessment: { status: 'passed' } });
        expect(c.lark.request).toHaveBeenCalledWith(
            expect.objectContaining({
                body: {
                    format: 'xml',
                    extra_param:
                        '{"enable_user_cite_reference_map":true,"return_html5_block_data":true}',
                    export_option: {
                        export_block_id: false,
                        export_style_attrs: false,
                        export_cite_extra_data: false,
                    },
                },
            }),
        );
    });
    it.each([
        'null',
        '{"word_count":null}',
        '{"word_count":{"min":1}}',
        '{"visual_plan":{"blocks":[{"type":"p","min_count":1}]}}',
        '{"unknown":1}',
    ])('rejects invalid decision %s', async (decision) => {
        await expect(
            command().preview({
                command: 'init-draft',
                'presentation-decision': decision,
            }),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});

describe('decision resource preflight', () => {
    it('reports missing local artifacts as assessment diagnostics', async () => {
        const missing = {
            ...files,
            stat: vi
                .fn()
                .mockRejectedValue(new Error('Artifact does not exist.')),
        };
        const result = await docsScriptCapability(missing, parser).execute(
            {
                command: 'parse',
                content: '<img path="@missing"/>',
                'presentation-decision': '{}',
            },
            context(),
        );
        expect(result).toMatchObject({
            assessment: { status: 'failed' },
            diagnostics: [{ code: 'resource_preflight_failed' }],
        });
    });
    it('groups remote image format failures and keeps private URLs out of diagnostics', async () => {
        const remote = {
            read: vi
                .fn()
                .mockRejectedValue(new Error('Content-Type is not supported.')),
            stream: vi.fn(),
            put: vi.fn(),
        };
        const result = await docsScriptCapability(
            files,
            parser,
            remote,
        ).execute(
            {
                command: 'parse',
                content:
                    '<img href="https://a.test/private?key=secret"/><img href="https://b.test/image"/>',
                'presentation-decision': '{}',
            },
            context(),
        );
        expect(result).toMatchObject({
            diagnostics: [
                {
                    code: 'remote_image_format_unsupported',
                    image_indices: [1, 2],
                },
            ],
        });
        expect(JSON.stringify(result)).not.toContain('secret');
    });
});
