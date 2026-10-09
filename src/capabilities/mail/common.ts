import { ServiceError } from '../../domain/errors';
import type { CommandContext } from '../../ports/capabilities';
export type Data = Record<string, any>;
export function invalid(message: string): never {
    throw new ServiceError('INVALID_ARGUMENTS', message);
}
export function mailbox(
    args: Data,
    context?: Pick<CommandContext, 'selection'>,
    compose = false,
): string {
    const value = String(args.mailbox || (compose ? args.from : '') || 'me');
    if (context?.selection.identity === 'bot' && value === 'me')
        invalid('Bot identity requires an explicit mailbox address.');
    if (!value.trim() || /[\r\n\0]/.test(value)) invalid('Invalid mailbox.');
    return value;
}
export function path(mailbox: string, ...segments: string[]): string {
    return `/open-apis/mail/v1/user_mailboxes/${[mailbox, ...segments].map(encodeURIComponent).join('/')}`;
}
export function list(value: unknown): string[] {
    if (value === undefined || value === '') return [];
    const values = Array.isArray(value) ? value : [value];
    if (values.some((item) => typeof item !== 'string'))
        invalid('Expected strings or an array of strings.');
    return values.flatMap((item) => item.split(','));
}
export function required(value: unknown, name: string): string {
    if (typeof value !== 'string' || !value.trim() || /[\r\n\0]/.test(value))
        invalid(`${name} must be nonblank.`);
    return value;
}
export function chunks<T>(items: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let index = 0; index < items.length; index += size)
        result.push(items.slice(index, index + size));
    return result;
}
