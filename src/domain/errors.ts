export class ServiceError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly status = 400,
        readonly details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = 'ServiceError';
    }
}

export function safeError(error: unknown): { code: string; message: string; details?: Record<string, unknown> } {
    if (error instanceof ServiceError) {
        return { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
    }
    return { code: 'INTERNAL_ERROR', message: 'The operation could not be completed.' };
}
