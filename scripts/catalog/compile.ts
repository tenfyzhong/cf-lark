import type { ApiDescriptor } from '../../src/domain/api-descriptor';
import type { JsonObject } from '../../src/domain/models';

interface Field {
    type?: string;
    description?: string;
    required?: boolean;
    location?: string;
    properties?: Record<string, Field>;
    items?: Field;
    enum?: unknown[];
    minimum?: number;
    maximum?: number;
}
interface Method {
    httpMethod: string;
    path: string;
    description?: string;
    risk?: string;
    accessTokens?: string[];
    scopes?: string[];
    parameters?: Record<string, Field>;
    requestBody?: Record<string, Field>;
}
interface Service {
    name: string;
    servicePath: string;
    resources: Record<string, { methods: Record<string, Method> }>;
}

function english(text: string | undefined, fallback: string): string {
    return text && !/\p{Script=Han}/u.test(text) ? text : fallback.replaceAll('_', ' ');
}

function property(name: string, field: Field): JsonObject {
    const types: Record<string, string> = { int: 'integer', int32: 'integer', int64: 'integer', float: 'number', double: 'number', bool: 'boolean', list: 'array', file: 'string' };
    const type = types[field.type ?? ''] ?? field.type ?? 'object';
    const output: JsonObject = { type: ['string', 'integer', 'number', 'boolean', 'object', 'array'].includes(type) ? type : 'string', description: english(field.description, name) };
    if (field.enum?.length) output.enum = field.enum;
    if (field.minimum !== undefined) output.minimum = field.minimum;
    if (field.maximum !== undefined) output.maximum = field.maximum;
    if (type === 'object' && field.properties) Object.assign(output, object(field.properties));
    if (type === 'array') output.items = field.items ? property(name + ' item', field.items) : {};
    return output;
}

function object(fields: Record<string, Field>, strict = false): JsonObject {
    return { type: 'object', properties: Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, property(key, field)])),
        required: Object.entries(fields).filter(([, field]) => field.required).map(([key]) => key), additionalProperties: !strict };
}

export function compileService(service: Service): ApiDescriptor[] {
    const result: ApiDescriptor[] = [];
    for (const [resource, value] of Object.entries(service.resources)) {
        for (const [methodName, method] of Object.entries(value.methods)) {
            const id = `${service.name}.${resource}.${methodName}`;
            const params = method.parameters ?? {};
            const paramsSchema = object(params);
            paramsSchema.required = [];
            const properties: JsonObject = {
                params: { anyOf: [paramsSchema, { type: 'string', description: 'JSON parameters or @artifact:<id>.' }] },
                output: { type: 'string', description: 'Save a binary response as a private artifact with this filename.' },
                'page-all': { type: 'boolean' }, 'page-limit': { type: 'integer', minimum: 0 }, 'page-delay': { type: 'integer', minimum: 0 },
                format: { type: 'string', description: 'json, ndjson, table or csv; unknown values fall back to json.' },
                json: { type: 'boolean' }, jq: { type: 'string' }, 'dry-run': { type: 'boolean' }, yes: { type: 'boolean' },
            };
            const acceptsBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.httpMethod);
            const fileFields = Object.entries(method.requestBody ?? {}).filter(([, field]) => field.type === 'file').map(([name]) => name).sort();
            if (acceptsBody) {
                const bodySchema = object(Object.fromEntries(Object.entries(method.requestBody ?? {}).filter(([, field]) => field.type !== 'file')));
                bodySchema.required = [];
                const body = { anyOf: [bodySchema, { type: 'array', items: {} }, { type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] };
                properties.body = body; properties.data = body;
                if (fileFields.length) properties.file = { anyOf: [{ type: 'string', description: '[field=]artifact:<id>/<filename>.' }, { type: 'object', properties: { id: { type: 'string' }, artifactId: { type: 'string' }, name: { type: 'string' }, filename: { type: 'string' }, field: { type: 'string' } }, additionalProperties: false }] };
            }
            const reserved = new Set([...Object.keys(properties), 'as', 'help', 'profile']);
            const parameterFlags: Record<string, string> = {};
            for (const [name, field] of Object.entries(params).sort(([left], [right]) => left.localeCompare(right))) {
                const flag = name.replaceAll('_', '-');
                if (reserved.has(flag)) continue;
                reserved.add(flag); parameterFlags[flag] = name;
                const typed = property(name, field), kind = typed.type;
                properties[flag] = kind === 'integer' || kind === 'boolean' ? { ...typed } : kind === 'array' ? { type: 'array', items: { type: 'string' }, description: typed.description } : { type: 'string', description: typed.description };
            }
            const required: string[] = [];
            result.push({
                definition: { id, domain: service.name, description: english(method.description, `${methodName} ${service.name} ${resource}`),
                    inputSchema: { type: 'object', properties, required, additionalProperties: false },
                    identities: (method.accessTokens ?? []).flatMap((token) => token === 'user' ? ['user' as const] : token === 'tenant' ? ['bot' as const] : []),
                    scopes: method.scopes ?? [], risk: method.risk === 'read' ? 'read' : 'write', source: 'api' },
                method: method.httpMethod as ApiDescriptor['method'],
                path: method.path.startsWith('/') ? method.path : `${service.servicePath}/${method.path}`,
                requiredParameters: Object.entries(params).filter(([, field]) => field.required).map(([name]) => name),
                parameterFlags, fileFields,
                parameters: Object.fromEntries(Object.entries(params).map(([key, field]) => [key, field.location === 'path' ? 'path' : 'query'])),
            });
        }
    }
    return result;
}
