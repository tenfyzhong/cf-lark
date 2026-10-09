export function ScopeList({ scopes }: { scopes: readonly string[] }) {
    return <details className="scope-list">
        <summary>Scopes ({scopes.length})</summary>
        {scopes.length ? <ul>{scopes.map((scope, index) => <li key={index}>{scope}</li>)}</ul> : <p>No scopes.</p>}
    </details>;
}
