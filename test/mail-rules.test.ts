import { describe, expect, it, vi } from 'vitest';
import {
    rulePlan,
    ruleProgram,
    decodeRule,
} from '../src/capabilities/mail/rules';
import { ServiceError } from '../src/domain/errors';
type Data = Record<string, any>;
const raw = {
    rule_id: 'r',
    name: 'Original',
    is_enable: true,
    condition: {
        match_type: 1,
        items: [{ type: 99, opaque: true }],
        future: 9,
    },
    action: { items: [{ type: 88 }] },
};
async function run(action: string, args: Data, responses: (Data | Error)[]) {
    const request = vi.fn();
    responses.forEach((r) =>
        r instanceof Error
            ? request.mockRejectedValueOnce(r)
            : request.mockResolvedValueOnce(r),
    );
    let state: Data = { action, args, phase: 'start' };
    for (let i = 0; i < 25; i++) {
        const count = request.mock.calls.length;
        const result = await ruleProgram().step(state, {
            selection: { identity: 'user' },
            grant: {},
            lark: { request },
        } as never);
        expect(request.mock.calls.length - count).toBeLessThanOrEqual(1);
        if (result.done) return { output: result.output as Data, request };
        state = result.state;
    }
    throw new Error('Unfinished');
}
describe('Mail rule semantic workflows', () => {
    it('encodes aliases, structured conditions and folder actions', () => {
        const plan = rulePlan('rule-create', {
            name: 'Rule',
            condition: ['sender:include:example.com', { field: 'has_attach' }],
            action: ['folder:folder_id=folder'],
            match: 'any',
        });
        expect(plan.raw).toMatchObject({
            is_enable: true,
            condition: {
                match_type: 2,
                items: [
                    { type: 1, operator: 1, input: 'example.com' },
                    { type: 16 },
                ],
            },
            action: { items: [{ type: 11, input: 'folder' }] },
        });
    });
    it('preserves unknown conditions and actions during rename and returns fallback after failed readback', async () => {
        const { output, request } = await run(
            'rule-update',
            { 'rule-id': 'r', name: 'Renamed' },
            [
                { rules: [raw] },
                {},
                new ServiceError('UPSTREAM_ERROR', 'Read denied'),
            ],
        );
        expect(request.mock.calls[1]![0].body).toMatchObject({
            name: 'Renamed',
            condition: raw.condition,
            action: raw.action,
        });
        expect(output.after_is_fallback).toBe(true);
        expect(output.after.unknowns).not.toHaveLength(0);
    });
    it('does not write when a toggle matches the current value', async () => {
        const { output, request } = await run(
            'rule-enable',
            { 'rule-id': 'r' },
            [{ rules: [raw] }],
        );
        expect(output.no_op).toBe(true);
        expect(request).toHaveBeenCalledTimes(1);
    });
    it('computes a stable relative reorder', async () => {
        const { output, request } = await run(
            'rule-reorder',
            { 'move-rule-id': 'c', 'before-rule-id': 'b' },
            [
                {
                    rules: ['a', 'b', 'c'].map((rule_id) => ({
                        ...raw,
                        rule_id,
                    })),
                },
                {},
            ],
        );
        expect(output.after_rule_ids).toEqual(['a', 'c', 'b']);
        expect(request.mock.calls[1]![0].body).toEqual({
            rule_ids: ['a', 'c', 'b'],
        });
    });
    it('rejects malformed semantics before requests', () => {
        for (const args of [
            { name: 'r', condition: 'all:equals:a', action: 'read' },
            { name: 'r', condition: 'subject:empty:value', action: 'read' },
            { name: 'r', condition: 'all', action: 'folder' },
            {
                name: 'r',
                condition: 'all',
                action: 'read',
                enable: true,
                disable: true,
            },
        ])
            expect(() => rulePlan('rule-create', args)).toThrow();
    });
    it('reports unknown enum and nested fields while retaining raw data', () => {
        const out = decodeRule(raw, 'me');
        expect(out.raw).toEqual(raw);
        expect(out.unknowns.map((x: Data) => x.path)).toContain(
            'condition.future',
        );
        expect(out.semantic_spec.rule.conditions).toEqual([]);
    });
    it('rejects incomplete full reorder without performing a mutation', async () => {
        await expect(
            run('rule-reorder', { 'rule-ids': ['r'] }, [
                { rules: [raw, { ...raw, rule_id: 'other' }] },
            ]),
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    });
});
