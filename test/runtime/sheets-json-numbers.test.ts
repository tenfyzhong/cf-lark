import { expect, it, vi } from 'vitest';
import { parseSheetJSON } from '../../src/capabilities/sheets/json';
import { tableWritePrograms } from '../../src/capabilities/sheets/table-write';
import type { CommandContext } from '../../src/ports/capabilities';
import type { JsonObject } from '../../src/domain/models';
import type { ApiRequest } from '../../src/ports/lark';
it('exposes exact numeric source text through the native Worker JSON reviver', () => {
    const seen: string[] = [];
    const parsed = parseSheetJSON('{"large":9007199254740993,"negative":-9007199254740993,"decimal":1.0000000000000001}', (_key, value, context) => {
        if (typeof value === 'number') { seen.push(context?.source ?? 'MISSING'); return context?.source; }
        return value;
    });
    expect(seen).toEqual(['9007199254740993', '-9007199254740993', '1.0000000000000001']);
    expect(parsed).toEqual({ large: '9007199254740993', negative: '-9007199254740993', decimal: '1.0000000000000001' });
});
it.each([
    '[{"name":"A","columns":["N"],"dtypes":{"N":"number"},"data":[[9007199254740993],[-9007199254740993],[1.0000000000000001]]}]',
    "[{'name':'A','columns':['N'],'dtypes':{'N':'number'},'data':[[9007199254740993],[-9007199254740993],[1.0000000000000001]],}]",
])('preserves exact unquoted typed numeric literals in outgoing table writes: %s', async sheets => {
    const request = vi.fn(async (_input: ApiRequest) => ({ output: '{}' }));
    const context = { lark: { request }, selection: { profileId: 'profile', identity: 'user', accountId: 'account' }, grant: { id: 'numeric-native', revoked: false, expiresAt: Date.now() + 60000, profiles: [{ profileId: 'profile', identities: ['user'], accounts: ['account'] }], domains: ['sheets'], permissions: ['write'] } } satisfies CommandContext;
    const program = tableWritePrograms().find(item => item.id === 'sheets-table-put')!;
    const result = await program.step({ phase: 'write', token: 'b', args: { sheets }, targets: [{ sheet_id: 'a', sheet_name: 'A' }] }, context);
    expect(result.done).toBe(true); expect(request).toHaveBeenCalledOnce();
    const serialized = String((request.mock.calls[0]![0].body as JsonObject).input);
    for (const source of ['9007199254740993', '-9007199254740993', '1.0000000000000001']) {
        expect(serialized).toContain(`"value":${source}`);
        expect(serialized).not.toContain(`"value":"${source}"`);
    }
    expect(serialized).not.toContain('9007199254740992');
});
