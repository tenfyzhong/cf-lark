import { useEffect, useState } from 'react';
import { api } from './api';
import { ScopeList } from './scope-list';

interface GrantSummary { id: string; clientId: string; scope: string[]; metadata?: { name?: string } }
export function Grants({ run }: { run: (action: () => Promise<void>) => Promise<void> }) {
    const [items, setItems] = useState<GrantSummary[]>([]);
    const [cursor, setCursor] = useState<string>();
    const load = async (next?: string) => {
        const result = await api<{ items: GrantSummary[]; cursor?: string }>(`/grants${next ? `?cursor=${encodeURIComponent(next)}` : ''}`);
        setItems((previous) => next ? [...previous, ...result.items] : result.items);
        setCursor(result.cursor);
    };
    useEffect(() => { void run(() => load()); }, []);
    return <section><h2>Authorized clients</h2><p>Revoking access invalidates the client's tokens. It can request new authorization later.</p>
        {items.map((grant) => <article key={grant.id}><h3>{grant.metadata?.name ?? 'OAuth client'}</h3><p>{grant.clientId}</p><ScopeList scopes={grant.scope} />
            <button onClick={() => void run(async () => { await api(`/grants/${grant.id}`, 'DELETE'); setItems((previous) => previous.filter((item) => item.id !== grant.id)); })}>Revoke access</button>
        </article>)}
        {!items.length && <p>No authorized clients.</p>}
        {cursor && <button onClick={() => void run(() => load(cursor))}>Load more</button>}
    </section>;
}
