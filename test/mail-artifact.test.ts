import { describe, expect, it, vi } from 'vitest';
import { readMailText } from '../src/capabilities/mail/files';
const context = {
    selection: { identity: 'user', profileId: 'p', accountId: 'a' },
    grant: {
        id: 'g',
        revoked: false,
        expiresAt: Date.now() + 600000,
        domains: ['mail', 'artifact'],
        permissions: ['read', 'write'],
        profiles: [{ profileId: 'p', identities: ['user'], accounts: ['a'] }],
    },
};
describe('Mail private text inputs', () => {
    it('reads only grant-owned bounded UTF-8 artifacts', async () => {
        const files = {
            stat: vi.fn().mockResolvedValue({ size: 4 }),
            read: vi.fn().mockResolvedValue(new Response('text')),
        };
        expect(
            await readMailText(
                '@artifact',
                context as never,
                files as never,
                1024,
            ),
        ).toBe('text');
        expect(files.stat).toHaveBeenCalledWith('g', 'artifact');
        expect(files.read).toHaveBeenCalledWith('g', 'artifact');
    });
    it('rejects oversize artifacts before reading', async () => {
        const files = {
            stat: vi.fn().mockResolvedValue({ size: 1025 }),
            read: vi.fn(),
        };
        await expect(
            readMailText('artifact', context as never, files as never, 1024),
        ).rejects.toThrow();
        expect(files.read).not.toHaveBeenCalled();
    });
    it('requires artifact permission before metadata access', async () => {
        const files = { stat: vi.fn() };
        await expect(
            readMailText(
                'artifact',
                {
                    ...context,
                    grant: { ...context.grant, domains: ['mail'] },
                } as never,
                files as never,
                1024,
            ),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(files.stat).not.toHaveBeenCalled();
    });
});
describe('Mail rule artifact expansion', () => {
    it('expands @artifact grammar inputs inside the grant before planning writes', async () => {
        const { ruleProgram } = await import('../src/capabilities/mail/rules');
        const text = '[{"field":"all"}]',
            files = {
                stat: vi.fn().mockResolvedValue({ size: text.length }),
                read: vi.fn().mockResolvedValue(new Response(text)),
            };
        const result = await ruleProgram(false, files as never).step(
            {
                phase: 'start',
                action: 'rule-create',
                args: { name: 'Rule', conditions: '@rules', action: 'read' },
            },
            context as never,
        );
        expect(result.done).toBe(false);
        if (!result.done)
            expect(
                (result.state as Record<string, any>).raw.condition.items,
            ).toEqual([{ type: 12 }]);
    });
});
it('rejects nested artifact references instead of silently omitting rule conditions',async()=>{
 const {ruleProgram}=await import('../src/capabilities/mail/rules');const text='@another',files={stat:vi.fn().mockResolvedValue({size:text.length}),read:vi.fn().mockResolvedValue(new Response(text))};await expect(ruleProgram(false,files as never).step({phase:'start',action:'rule-create',args:{name:'Rule',conditions:'@rules',action:'read'}},context as never)).rejects.toThrow('Nested');
});
