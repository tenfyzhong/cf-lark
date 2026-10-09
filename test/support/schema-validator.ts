import Ajv from 'ajv';
import { SchemaValidator } from '../../src/infrastructure/validation/schema-validator';

export function fixtureValidator() {
    const ajv = new Ajv({ strict: false, allErrors: true, coerceTypes: false });
    return new SchemaValidator((schema) => ajv.compile(schema));
}
