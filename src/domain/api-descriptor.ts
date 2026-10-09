import type { CommandDefinition } from './models';

export interface ApiDescriptor {
    definition: CommandDefinition;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    parameters: Record<string, 'path' | 'query'>;
    requiredParameters?: string[];
    parameterFlags?: Record<string, string>;
    fileFields?: string[];
}
