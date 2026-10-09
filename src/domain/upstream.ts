import { ServiceError } from './errors';
import type { Brand } from './models';

export function endpoints(brand: Brand): { open: string; accounts: string } {
    if (brand === 'feishu') return { open: 'https://open.feishu.cn', accounts: 'https://accounts.feishu.cn' };
    if (brand === 'lark') return { open: 'https://open.larksuite.com', accounts: 'https://accounts.larksuite.com' };
    throw new ServiceError('INVALID_BRAND', 'Brand must be feishu or lark.');
}

export function validateApiPath(path: string): string {
    if (!path.startsWith('/open-apis/') || /[?#\\\s\u0000-\u001f]/u.test(path)) {
        throw new ServiceError('INVALID_API_PATH', 'An absolute Open API path is required.');
    }
    let decoded = path;
    for (let i = 0; i < 8; i++) {
        let next: string;
        try { next = decodeURIComponent(decoded); } catch { throw new ServiceError('INVALID_API_PATH', 'Invalid path encoding.'); }
        if (/[?#\\\s\u0000-\u001f]/u.test(next) || next.split('/').some((part) => part === '.' || part === '..') || next.includes('//')) {
            throw new ServiceError('INVALID_API_PATH', 'Unsafe Open API path.');
        }
        if (next === decoded) return path;
        decoded = next;
    }
    throw new ServiceError('INVALID_API_PATH', 'Excessive path encoding.');
}
