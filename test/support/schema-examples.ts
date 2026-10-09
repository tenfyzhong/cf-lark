import type { JsonObject } from '../../src/domain/models';

function example(schema: Record<string, unknown>): unknown {
    const choices = schema.anyOf ?? schema.oneOf;
    if (Array.isArray(choices) && choices.length) return example(choices[0] as Record<string, unknown>);
    if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
    switch (schema.type) {
        case 'object':
            return Object.fromEntries(Object.entries((schema.properties ?? {}) as Record<string, Record<string, unknown>>)
                .map(([key, value]) => [key, example(value)]));
        case 'array':
            return [example((schema.items ?? {}) as Record<string, unknown>)];
        case 'integer':
        case 'number':
            return Math.max(1, Number(schema.minimum ?? 0));
        case 'boolean':
            return false;
        case 'null':
            return null;
        default:
            return 'fixture/value';
    }
}
export function exampleArguments(schema: Record<string, unknown>): JsonObject {
    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
    if (properties && (properties.params || properties.body)) {
        return example({ ...schema, properties: Object.fromEntries(Object.entries(properties)
            .filter(([key]) => key === 'params' || key === 'body')) }) as JsonObject;
    }
    return example(schema) as JsonObject;
}
