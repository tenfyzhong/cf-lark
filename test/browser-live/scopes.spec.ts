import { test } from '@playwright/test';
import { registerScopeDisclosureTests } from '../support/management-scope-browser';

test.skip(!process.env.LARK_LIVE_URL, 'A live origin must be explicitly configured.');

// Exercise deployed UI assets with fixture admin data, without production credentials.
registerScopeDisclosureTests();
