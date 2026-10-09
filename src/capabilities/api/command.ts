import type { ApiDescriptor } from '../../domain/api-descriptor';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { Capability, CommandContext } from '../../ports/capabilities';
import type { ApiRequest } from '../../ports/lark';
import type { WorkflowProgram, WorkflowRunner } from '../../ports/workflows';
import { resolveJSON, parseFile, object, invalid } from '../raw-api/input';
import { executeApi, genericApiProgram, validatePlan, type ApiDependencies, type ApiPlan } from '../raw-api/runner';

export interface TypedApiDependencies extends ApiDependencies { workflows?: WorkflowRunner; }
const bodyMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
function programId(descriptor: ApiDescriptor): string { return `typed-api-${descriptor.definition.domain}-${descriptor.definition.risk}`; }
function missing(value: unknown): boolean { return value === undefined || value === null || value === ''; }
function identifier(value: unknown, key: string): string {
    const text = String(value);
    if (text.split('/').includes('..') || /[?#%\x00-\x1f\x7f\u200b-\u200d\ufeff\u2028-\u202e\u2066-\u2069]/u.test(text)) invalid(`Invalid path parameter: ${key}.`);
    return encodeURIComponent(text);
}

export function apiCapability(descriptor: ApiDescriptor, dependencies: TypedApiDependencies = {}): Capability {
    async function prepare(args: JsonObject, context?: CommandContext): Promise<ApiPlan> {
        if (args.body !== undefined && args.data !== undefined) invalid('body and data are aliases; provide only one.');
        const parsed = await resolveJSON(args.params, 'params', context, dependencies.artifacts);
        if (parsed !== undefined && !object(parsed)) invalid('params must be a JSON object.');
        const parameters: JsonObject = { ...(parsed as JsonObject ?? {}) };
        for (const [flag, key] of Object.entries(descriptor.parameterFlags ?? {})) if (Object.hasOwn(args, flag)) parameters[key] = args[flag];
        const path = descriptor.path.replace(/\{([^}]+)\}/gu, (_placeholder, key: string) => {
            const value = parameters[key];
            if (missing(value)) throw new ServiceError('MISSING_PARAMETER', `Missing path parameter: ${key}.`);
            delete parameters[key]; return identifier(value, key);
        });
        const query: JsonObject = {};
        for (const [key, location] of Object.entries(descriptor.parameters)) {
            if (location !== 'query') continue;
            const value = parameters[key], pagination = args['page-all'] === true && ['page_size', 'page_token'].includes(key);
            if (descriptor.requiredParameters?.includes(key) && missing(value) && !pagination) throw new ServiceError('MISSING_PARAMETER', `Missing query parameter: ${key}.`);
            if (!missing(value)) query[key] = value;
            delete parameters[key];
        }
        for (const [key, value] of Object.entries(parameters)) Object.defineProperty(query, key, { value, enumerable: true, writable: true, configurable: true });
        const bodyInput = args.body !== undefined ? args.body : args.data;
        if (bodyInput !== undefined && !bodyMethods.has(descriptor.method)) invalid('This method does not accept a request body.');
        const body = await resolveJSON(bodyInput, 'data', context, dependencies.artifacts);
        if (args.file !== undefined && !(descriptor.fileFields?.length && bodyMethods.has(descriptor.method))) invalid('This API does not declare a file upload field.');
        const file = parseFile(args.file, descriptor.fileFields?.length === 1 ? descriptor.fileFields[0]! : 'file');
        const request: ApiRequest = { method: descriptor.method, path, query, ...(body === undefined ? {} : { body }) };
        const plan: ApiPlan = { request, ...(file ? { file } : {}), pageAll: args['page-all'] === true,
            pageLimit: args['page-limit'] as number | undefined, pageDelay: args['page-delay'] as number | undefined,
            output: args.output ? String(args.output) : undefined, jq: args.jq ? String(args.jq) : undefined,
            format: args.json === true ? 'json' : args.format ? String(args.format) : undefined };
        await validatePlan(plan, dependencies);
        return plan;
    }
    const preview: Capability['preview'] = async (args, context) => {
        try {
            const plan = await prepare(args, context as CommandContext | undefined);
            return { ...plan.request, ...(plan.file ? { file: plan.file } : {}), ...(plan.output ? { output: plan.output } : {}),
                ...(plan.pageAll ? { pagination: { pageLimit: plan.pageLimit ?? 10, pageDelay: plan.pageDelay || 200 } } : {}),
                ...(plan.jq ? { jq: plan.jq } : {}), ...(plan.format ? { format: plan.format } : {}) };
        } catch (error) {
            if (!context && error instanceof ServiceError && error.code === 'ARTIFACT_INPUT_REQUIRED') return { method: descriptor.method, path: descriptor.path, deferredArtifactInputs: true, arguments: args };
            throw error;
        }
    };
    return { definition: descriptor.definition, preview, execute: async (args, context) => {
        if (args['dry-run'] === true) return preview(args, context);
        const plan = await prepare(args, context);
        if (!plan.pageAll && !plan.file && !plan.output && !plan.jq && (!plan.format || plan.format === 'json')) return context.lark.request(plan.request);
        if (!dependencies.workflows) throw new ServiceError('UNAVAILABLE', 'Typed API workflow execution is unavailable.', 503);
        return executeApi(plan, context, dependencies, dependencies.workflows, programId(descriptor));
    } };
}

export function apiPrograms(descriptors: readonly ApiDescriptor[], dependencies: ApiDependencies = {}): WorkflowProgram[] {
    const unique = new Map<string, ApiDescriptor>();
    for (const descriptor of descriptors) unique.set(programId(descriptor), descriptor);
    return [...unique].map(([id, descriptor]) => genericApiProgram({ id, domain: descriptor.definition.domain, risk: descriptor.definition.risk }, dependencies));
}
