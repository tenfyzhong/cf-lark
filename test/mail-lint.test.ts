import { describe, expect, it, vi } from 'vitest';
import { lintPlan, lintMail } from '../src/capabilities/mail/lint';
describe('Mail HTML lint capability', () => {
    it('returns a compact cleaned body by default and findings on request', async () => {
        const transform = {
            processMail: vi
                .fn()
                .mockResolvedValue({
                    cleaned_html: 'safe',
                    lint_applied: [{ rule_id: 'RULE' }],
                    original_blocked: [],
                }),
        };
        expect(
            await lintMail(
                { body: '<p>test</p>' },
                {} as never,
                undefined,
                transform,
            ),
        ).toEqual({ cleaned_html: 'safe' });
        expect(
            await lintMail(
                { body: '<p>test</p>', 'show-lint-details': true },
                {} as never,
                undefined,
                transform,
            ),
        ).toEqual({
            cleaned_html: 'safe',
            warnings: [{ rule_id: 'RULE' }],
            errors: [],
        });
    });
    it('validates exactly one input and previews file identity without IO', () => {
        expect(() => lintPlan({ body: 'one', 'body-file': 'file' })).toThrow();
        expect(() => lintPlan({})).toThrow();
        expect(lintPlan({ 'body-file': 'file' })).toMatchObject({
            mode: 'local-lint-only',
            artifactId: 'file',
        });
    });
});
