import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Dispatcher } from '../src/application/dispatcher';
import { mcpResponse } from '../src/adapters/mcp/handler';
import { Registry } from '../src/capabilities/registry';
import { artifactDefinitions } from '../src/capabilities/artifact/definitions';
import { workflowDefinition } from '../src/capabilities/workflow/definition';
import { eventConsumerDefinitions } from '../src/capabilities/event/lifecycle-definitions';
import { mailDefinitions } from '../src/capabilities/mail/definitions';
import type { CommandDefinition, Grant } from '../src/domain/models';
import { fixtureValidator } from './support/schema-validator';

const root = 'cf-lark://guidance/v1/';
const docs: CommandDefinition = { id: 'docs.+read', domain: 'docs', description: 'Read document.', risk: 'read', source: 'shortcut', inputSchema: { type: 'object', properties: {} }, identities: ['user'], scopes: [] };
const definitions = [docs, { ...docs, id: 'docs.+create', risk: 'write' as const }, { ...docs, id: 'docs.+bot-only', identities: ['bot' as const] }, ...artifactDefinitions, workflowDefinition, ...eventConsumerDefinitions, mailDefinitions.find(d => d.id === 'mail.+watch')!];
function setup(overrides: Partial<Grant> = {}) {
    const grant: Grant = { id: 'g', expiresAt: Date.now() + 60_000, revoked: false, profiles: [{ profileId: 'p', accounts: ['a'], identities: ['user'] }], domains: ['docs', 'artifact', 'workflow', 'event', 'mail'], permissions: ['read', 'write'], ...overrides };
    const execute = vi.fn(async () => ({}));
    const createClient = vi.fn(async () => ({ request: vi.fn() }));
    const dispatcher = new Dispatcher(new Registry(definitions.map(definition => ({ definition, execute, preview: async () => ({}) }))), fixtureValidator(), createClient);
    return { grant, dispatcher, execute, createClient };
}

describe('versioned agent guidance', () => {
    it('links discoverable skills and references from search and schema', () => {
        const { dispatcher, grant, createClient } = setup();
        expect(dispatcher.search({ query: '' }, grant)).toMatchObject({ guidance: { version: 1, indexUri: `${root}index` } });
        expect(dispatcher.schema('docs.+read', grant)).toMatchObject({
            guidance: { version: 1, skillUri: `${root}skills/docs` },
            affordance: { argumentConvention: 'flat-flags', schemaRequired: true, preview: { supported: true, dryRun: true }, risk: 'read' },
        });
        expect(createClient).not.toHaveBeenCalled();
    });
    it('returns versioned skills with a bounded preview and explicit full-catalog query', () => {
        const { dispatcher, grant } = setup();
        const index = dispatcher.readGuidance(`${root}index`, grant);
        expect(index).toMatchObject({ version: 1, kind: 'index', authority: 'reference-only' });
        const skill = dispatcher.readGuidance(`${root}skills/docs`, grant);
        expect(skill).toMatchObject({ version: 1, kind: 'skill', domain: 'docs', availableCommandCount: 2, discovery: { tool: 'lark_search', arguments: { domain: 'docs', query: '' } } });
        expect(skill.commands).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'docs.+create', risk: 'write' })]));
        expect(JSON.stringify(skill)).not.toContain('docs.+bot-only');
    });
    it('keeps denied domains, writes, and identities out of resource lists and reads', () => {
        const { dispatcher, grant, createClient } = setup({ domains: ['docs'], permissions: ['read'] });
        const resources = dispatcher.guidanceResources(grant);
        expect(resources.map(item => item.uri)).toContain(`${root}skills/docs`);
        expect(resources.map(item => item.uri)).not.toContain(`${root}skills/mail`);
        expect(resources.map(item => item.uri)).not.toContain(`${root}references/artifacts`);
        expect(JSON.stringify(dispatcher.readGuidance(`${root}skills/docs`, grant))).not.toMatch(/docs\.\+create|bot-only/);
        expect(() => dispatcher.readGuidance(`${root}skills/mail`, grant)).toThrow();
        expect(() => dispatcher.readGuidance(`${root}references/artifacts`, grant)).toThrow();
        expect(() => dispatcher.readGuidance('cf-lark://guidance/v2/index', grant)).toThrow();
        expect(createClient).not.toHaveBeenCalled();
    });
    it('documents exact workflow continuation and uncertainty semantics', () => {
        const { dispatcher, grant } = setup();
        expect(dispatcher.readGuidance(`${root}references/workflows`, grant)).toMatchObject({
            version: 1, resume: { command: 'workflow.resume', args: { id: '$workflowId' }, selection: 'exact-returned-selection' },
            scheduling: { nextRunAt: 'unix-milliseconds', retryAfter: 'milliseconds' },
            uncertain: { code: 'OUTCOME_UNCERTAIN', restartInitiatingCommand: false },
            completed: { replayStoredResult: true }, maxLifetimeSeconds: 86400,
        });
    });
    it('documents grant-owned artifact transports and actual bounded resource defaults', () => {
        const { dispatcher, grant } = setup();
        expect(dispatcher.readGuidance(`${root}references/artifacts`, grant)).toMatchObject({ ownership: 'authorization-grant', inlineBytes: 524288, uploadPartBytes: 67108864 });
        expect(dispatcher.readGuidance(`${root}references/limits`, grant)).toMatchObject({
            storage: { defaultBytes: 2000000000, defaultRetentionSeconds: 86400, sharedWithWorkflowSpill: true },
            workflows: { serializedBytes: 33554432, jsonValues: 100000, nestingLevels: 128 },
            mail: { finalMimeBytes: 26214400, textMarkupBudgetBytes: 8388608, markupDelimiterCostBytes: 256 },
            docs: { parserInputBytes: 20000000, xmlMarkupDelimiters: 32768, markupTextBytes: 2097152 },
        });
        const readOnly = dispatcher.readGuidance(`${root}references/artifacts`, { ...grant, permissions: ['read'] });
        expect(JSON.stringify(readOnly)).not.toContain('"method":"POST"');
        expect(JSON.stringify(readOnly)).not.toContain('artifact.upload');
    });
    it('separates callback cursor watches, consumer IDs, stop, and workflow resume', () => {
        const { dispatcher, grant } = setup();
        expect(dispatcher.readGuidance(`${root}references/watches`, grant)).toMatchObject({ transport: 'verified-callback-inbox', persistentMcpListener: false, prerequisites: expect.arrayContaining(['owner-configured-verified-callbacks']), inbox: { maxPageEvents: 100 } });
        const text = JSON.stringify(dispatcher.readGuidance(`${root}references/watches`, grant));
        expect(text).toContain('consumerId');
        expect(text).toContain('event.stop');
        expect(text).toContain('mail.+watch');
    });
    it('does not turn query text or guidance reads into write authorization', async () => {
        const { dispatcher, grant, createClient, execute } = setup({ domains: ['docs'], permissions: ['read'] });
        expect(dispatcher.search({ query: '\u521b\u5efa\u6587\u6863' }, grant).commands).toHaveLength(0);
        dispatcher.readGuidance(`${root}index`, grant);
        await expect(dispatcher.execute({ command: 'docs.+create', args: {}, identity: 'user' }, grant)).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(createClient).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
        expect(() => dispatcher.guidanceResources({ ...grant, revoked: true })).toThrow();
        expect(() => dispatcher.readGuidance(`${root}index`, { ...grant, expiresAt: 0 })).toThrow();
    });
    it('bounds a large domain skill explicitly and preserves search pagination', () => {
        const { grant } = setup();
        const definitions = Array.from({ length: 25 }, (_, index) => ({ ...docs, id: `docs.read-${index}` }));
        const dispatcher = new Dispatcher(new Registry(definitions.map(definition => ({ definition, execute: vi.fn(), preview: vi.fn() }))), fixtureValidator(), vi.fn());
        const skill = dispatcher.readGuidance(`${root}skills/docs`, grant);
        expect(skill).toMatchObject({ availableCommandCount: 25, previewLimit: 20, previewTruncated: true });
        expect(skill.commands).toHaveLength(20);
        const first = dispatcher.search({ query: '\u6587\u6863', limit: 20 }, grant);
        expect(first.next_cursor).toBe('20');
        const second = dispatcher.search({ query: '\u6587\u6863', limit: 20, cursor: first.next_cursor }, grant);
        expect(second.commands).toHaveLength(5);
        expect(second.next_cursor).toBeUndefined();
        expect([...first.commands, ...second.commands].map(command => command.id)).toEqual(definitions.map(definition => definition.id));
    });
    it('labels mixed-risk schemas and leaves denied helper domains unavailable', () => {
        const { grant } = setup({ domains: ['api'], permissions: ['read'] });
        const definition = { ...docs, id: 'api.request', domain: 'api', source: 'service' as const, risk: 'write' as const };
        const dispatcher = new Dispatcher(new Registry([{ definition, risk: () => 'read', execute: vi.fn(), preview: vi.fn() }]), fixtureValidator(), vi.fn());
        expect(dispatcher.schema('api.request', grant)).toMatchObject({ affordance: { riskByArguments: true, argumentConvention: 'explicit-schema-fields', resultHandling: { additionalConsentDomain: 'workflow' } } });
        expect(dispatcher.guidanceResources(grant).map(item => item.uri)).not.toContain(`${root}references/workflows`);
        expect(dispatcher.readGuidance(`${root}references/limits`, grant)).toMatchObject({ api: { artifactJsonInputBytes: 2097152, jqInputBytes: 1048576, jqJsonValues: 16384, defaultPageLimit: 10, defaultPageDelayMilliseconds: 200 } });
    });
    it('supports MCP SDK resource list/read with read-time revocation checks', async () => {
        const { dispatcher, grant, createClient } = setup();
        const client = new Client({ name: 'guidance-test', version: '1.0.0' });
        await client.connect(new StreamableHTTPClientTransport(new URL('https://example.com/mcp'), { fetch: async (input, init) => mcpResponse(new Request(input, init), dispatcher, grant) }));
        try {
            const resources = await client.listResources();
            expect(resources.resources.map(item => item.uri)).toContain(`${root}index`);
            const result = await client.readResource({ uri: `${root}skills/docs` });
            expect(result.contents[0]).toMatchObject({ mimeType: 'application/json', uri: `${root}skills/docs` });
            const content = result.contents[0]!;
            expect('text' in content && JSON.parse(content.text)).toMatchObject({ version: 1, domain: 'docs' });
            await expect(client.readResource({ uri: `${root}skills/unknown` })).rejects.toThrow();
            grant.revoked = true;
            await expect(client.readResource({ uri: `${root}index` })).rejects.toThrow();
            expect(createClient).not.toHaveBeenCalled();
        } finally { await client.close(); }
    });
});
