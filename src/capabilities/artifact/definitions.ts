import type { CommandDefinition } from '../../domain/models';

const base = { domain: 'artifact', source: 'service' as const, identities: ['user', 'bot'] as const, scopes: [] };
const idSchema = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', minLength: 1 } } };
export const artifactDefinitions: CommandDefinition[] = [
    { ...base, id: 'artifact.upload', risk: 'write', description: 'Store up to 512 KiB of Base64-encoded file content in private temporary storage. Larger files use authenticated POST /mcp/artifacts with Content-Length. Returns an artifact ID for cloud file workflows.',
        inputSchema: { type: 'object', additionalProperties: false, required: ['content'], properties: { content: { type: 'string', minLength: 4, maxLength: 699052 } } } },
    { ...base, id: 'artifact.read', risk: 'read', description: 'Read up to 512 KiB of a temporary artifact as Base64. Larger files use authenticated GET /mcp/artifacts/{id}. Only artifacts owned by this connection are accessible.', inputSchema: idSchema },
    { ...base, id: 'artifact.delete', risk: 'write', description: 'Delete a private temporary artifact owned by this connection and release its storage reservation.', inputSchema: idSchema },
];
