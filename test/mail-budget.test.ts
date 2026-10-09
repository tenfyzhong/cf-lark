import { expect, it } from 'vitest';
import { enforceMailBudget } from '../src/infrastructure/documents/mail-budget';
it('accepts text-heavy bodies and rejects measured dense HTML before the Go runtime', () => {
    expect(() =>
        enforceMailBudget({
            operation: 'lint',
            body: '<p>' + 'x'.repeat(8 * 1024 * 1024 - 1024) + '</p>',
        }),
    ).not.toThrow();
    expect(() =>
        enforceMailBudget({
            operation: 'lint',
            body: '<p>x</p>'.repeat(32768),
        }),
    ).toThrow('complexity');
    expect(() =>
        enforceMailBudget({
            operation: 'lint',
            body: '<p>x</p>'.repeat(15000),
        }),
    ).not.toThrow();
});
it('combines separately supplied HTML body fragments without counting opaque attachments', () => {
    expect(() =>
        enforceMailBudget({
            operation: 'template-body',
            body: 'x'.repeat(5 * 1024 * 1024),
            template: { template_content: 'y'.repeat(4 * 1024 * 1024) },
        }),
    ).toThrow('complexity');
    expect(() =>
        enforceMailBudget({
            operation: 'build-eml',
            text: 'Body',
            attachments: [{ data: 'A'.repeat(12 * 1024 * 1024) }],
        }),
    ).not.toThrow();
    expect(() =>
        enforceMailBudget({
            operation: 'edit-eml',
            patch: {
                ops: [{ op: 'set_body', value: '<p>x</p>'.repeat(32768) }],
            },
        }),
    ).toThrow('complexity');
});
