import { accessJwks } from './access-fixture';

// Loopback-only browser fixture: serves public test keys and never issues tokens.
export default {
    fetch(request: Request) {
        return new URL(request.url).pathname === '/cdn-cgi/access/certs'
            ? Response.json(accessJwks) : new Response('Not found.', { status: 404 });
    },
};
