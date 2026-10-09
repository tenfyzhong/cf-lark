import type { Capability } from '../../ports/capabilities';
import { documentCreateCapability } from './documents.ts';
import { messageSendCapability } from './messages.ts';

export function shortcutCapabilities(pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): Capability[] {
    return [documentCreateCapability(pause), messageSendCapability()];
}
