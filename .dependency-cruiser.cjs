module.exports = {
    forbidden: [
        { name: 'no-cycles', severity: 'error', from: {}, to: { circular: true } },
        { name: 'domain-is-pure', severity: 'error', from: { path: '^src/domain/' }, to: { pathNot: '^src/domain/' } },
        { name: 'ports-point-inward', severity: 'error', from: { path: '^src/ports/' }, to: { pathNot: '^src/(domain|ports)/' } },
        { name: 'application-is-platform-independent', severity: 'error', from: { path: '^src/application/' }, to: { pathNot: '^src/(domain|ports|application)/' } },
        { name: 'capabilities-use-ports', severity: 'error', from: { path: '^src/capabilities/' }, to: { path: '^src/(application|adapters|infrastructure|bootstrap)/' } },
        { name: 'adapters-avoid-infrastructure', severity: 'error', from: { path: '^src/adapters/' }, to: { path: '^src/(infrastructure|bootstrap|capabilities)/' } },
        { name: 'infrastructure-avoids-use-cases', severity: 'error', from: { path: '^src/infrastructure/' }, to: { path: '^src/(application|adapters|bootstrap|capabilities)/' } },
        { name: 'ui-uses-http-contracts', severity: 'error', from: { path: '^ui/' }, to: { path: '^src/' } },
    ],
    options: { tsConfig: { fileName: 'tsconfig.json' }, doNotFollow: { path: 'node_modules' }, exclude: 'node_modules' },
};
