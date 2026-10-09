import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
const MAX_COMPLEXITY = 8 * 1024 * 1024;
const MARKUP_COST = 256;
const object = (value: unknown): JsonObject =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as JsonObject)
        : {};
/** Measured DOM allocation guard; attachment payloads are streamed separately. */
export function enforceMailBudget(input: JsonObject): void {
    const fragments: unknown[] = [
        input.body,
        input.text,
        input.html,
        input.signature_html,
    ];
    if (input.operation === 'template-body')
        fragments.push(object(input.template).template_content);
    if (input.operation === 'quote')
        fragments.push(object(input.original).body);
    const operations = object(input.patch).ops;
    if (Array.isArray(operations))
        for (const item of operations) {
            const operation = object(item);
            if (
                [
                    'set_body',
                    'set_reply_body',
                    'replace_body',
                    'append_body',
                ].includes(String(operation.op))
            )
                fragments.push(operation.value);
        }
    for (const value of Object.values(object(input.signature_by_op)))
        fragments.push(value);
    let budget = 0;
    const encoder = new TextEncoder();
    for (const value of fragments) {
        if (typeof value !== 'string') continue;
        budget += encoder.encode(value).byteLength;
        for (
            let index = value.indexOf('<');
            index >= 0;
            index = value.indexOf('<', index + 1)
        )
            budget += MARKUP_COST;
        if (budget > MAX_COMPLEXITY)
            throw new ServiceError(
                'MAIL_COMPLEXITY_LIMIT',
                'Mail text/HTML complexity exceeds the hosted 8 MiB combined text and markup budget.',
                413,
            );
    }
}
