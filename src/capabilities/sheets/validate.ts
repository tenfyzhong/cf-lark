import { ServiceError } from '../../domain/errors';
import { flagValidators } from './generated/flags';
export function validateSheetFlag(name: string, flag: string, value: unknown): void {
    const validate = flagValidators[`${name}:${flag}` as keyof typeof flagValidators] as (((data: unknown) => boolean) & { errors?: unknown }) | undefined;
    if (validate && !validate(value)) throw new ServiceError('INVALID_ARGUMENTS', `Invalid ${name} ${flag}: ${JSON.stringify(validate.errors)}`);
}
