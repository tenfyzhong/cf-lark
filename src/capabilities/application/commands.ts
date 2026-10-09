import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability } from '../../ports/capabilities';
import type { ApiRequest, LarkClient } from '../../ports/lark';
import { applicationDefinitions } from './definitions';

const path = '/open-apis/application/v7/app_slash_commands';
function invalid(message: string): never { throw new ServiceError('INVALID_ARGUMENTS', message); }
function prepare(action: string, args: JsonObject) {
    const command = String(args.command ?? '').trim();
    const id = String(args['command-id'] ?? '').trim();
    if (action === 'list') return { command, id, body: {} as JsonObject };
    if (command.startsWith('/')) invalid('command must omit the leading slash.');
    if (action === 'create' && (!command || !String(args.description ?? '').trim())) invalid('command and description must not be blank.');
    if ((action === 'update' || action === 'delete') && Boolean(command) === Boolean(id)) invalid('Provide exactly one command-id or command.');
    const values = args['description-i18n'] ?? [];
    if (!Array.isArray(values)) invalid('description-i18n must be an array of language=text pairs.');
    const i18n: Record<string, string> = Object.create(null);
    for (const value of values) {
        if (typeof value !== 'string') invalid('Each localized description must be language=text.');
        const index = value.indexOf('=');
        const language = value.slice(0, index).trim(), text = value.slice(index + 1);
        if (index <= 0 || !language || !text.trim() || Object.hasOwn(i18n, language)) invalid('Localized descriptions require unique nonblank languages and text.');
        i18n[language] = text;
    }
    if (action === 'update') {
        const description = String(args.description ?? '').trim();
        if (values.length && !description) invalid('Localized descriptions require a default description.');
        if (!description && !values.length && !String(args['icon-key'] ?? '').trim()) invalid('Provide at least one editable field.');
    }
    const body: JsonObject = {};
    if (action === 'create') body.command = command;
    if (args.description || values.length) body.description = { ...(args.description ? { default_value: args.description } : {}), ...(values.length ? { i18n } : {}) };
    if (args['icon-key']) body.icon = { icon_key: args['icon-key'] };
    return { command, id, body };
}
async function resolve(client: LarkClient, command: string): Promise<string> {
    const response = await client.request({ method: 'GET', path });
    const matches = (Array.isArray(response.items) ? response.items : []).filter((item: JsonObject) => item.command === command);
    if (matches.length !== 1 || typeof matches[0]?.command_id !== 'string' || !matches[0].command_id.trim()) {
        throw new ServiceError(matches.length > 1 ? 'AMBIGUOUS_COMMAND' : 'COMMAND_NOT_FOUND', 'The command name must resolve to exactly one command ID.', 404);
    }
    return matches[0].command_id.trim();
}
export function applicationCapabilities(): Capability[] {
    return applicationDefinitions.map((definition) => {
        const action = definition.id.split('-').at(-1)!;
        return { definition,
            preview: async (args) => {
                const value = prepare(action, args);
                const requests: ApiRequest[] = [];
                if (action === 'list') requests.push({ method: 'GET', path });
                else if (action === 'create') requests.push({ method: 'POST', path, body: value.body });
                else {
                    if (!value.id) requests.push({ method: 'GET', path });
                    requests.push({ method: action === 'delete' ? 'DELETE' : 'PATCH', path: `${path}/${value.id ? encodeURIComponent(value.id) : '{resolved_command_id}'}`,
                        ...(action === 'update' ? { body: value.body } : {}) });
                }
                return { requests, ...(action === 'create' && args.force ? { onNameCollision: 'Resolve the existing name and PATCH its description and icon.' } : {}) };
            },
            execute: async (args, context) => {
                const value = prepare(action, args);
                if (action === 'list') {
                    const result = await context.lark.request({ method: 'GET', path });
                    const items = Array.isArray(result.items) ? result.items : [];
                    return { items, count: items.length };
                }
                if (action === 'create') {
                    try { return { ...await context.lark.request({ method: 'POST', path, body: value.body }), action: 'created' }; }
                    catch (error) {
                        if (args.force !== true || !(error instanceof ServiceError) || error.details?.upstreamCode !== 40000000 || error.details?.reason !== 'command_already_exists') throw error;
                        const id = await resolve(context.lark, value.command);
                        const { command: _command, ...body } = value.body;
                        return { ...await context.lark.request({ method: 'PATCH', path: `${path}/${encodeURIComponent(id)}`, body }), action: 'updated' };
                    }
                }
                const id = value.id || await resolve(context.lark, value.command);
                if (action === 'delete') {
                    await context.lark.request({ method: 'DELETE', path: `${path}/${encodeURIComponent(id)}` });
                    return { action: 'deleted', command_id: id, ...(value.command ? { command: value.command } : {}) };
                }
                return { ...await context.lark.request({ method: 'PATCH', path: `${path}/${encodeURIComponent(id)}`, body: value.body }), action: 'updated' };
            },
        };
    });
}
