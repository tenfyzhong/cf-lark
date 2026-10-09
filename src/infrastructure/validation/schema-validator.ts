import type { ErrorObject } from 'ajv';
import { ServiceError } from '../../domain/errors';
import type { JsonObject } from '../../domain/models';
import type { InputValidator } from '../../ports/capabilities';
import { compiledSchemas } from './generated/validators';

type CompiledValidator = ((input: unknown) => boolean) & { errors?: ErrorObject[] | null };
const validators = compiledSchemas as unknown as ReadonlyMap<string, CompiledValidator>;

export class SchemaValidator implements InputValidator {
    constructor(private readonly resolve: (schema: JsonObject) => CompiledValidator | undefined =
        (schema) => validators.get(JSON.stringify(schema))) {}

    validate(schema: JsonObject, input: unknown): void {
        const validator = this.resolve(schema);
        if (!validator) throw new ServiceError('SCHEMA_NOT_COMPILED', 'The command schema is not available in this deployment.', 500);
        if (!validator(input)) {
            throw new ServiceError('INVALID_ARGUMENTS', 'Command arguments do not match the schema.', 400, {
                violations: validator.errors?.map(({ instancePath, keyword, message }) => ({ path: instancePath, keyword, message })),
            });
        }
    }
}
