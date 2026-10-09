import { useEffect, useRef, useState } from 'react';
import { api } from './api';

interface ConsentData {
    client: { clientName: string; redirectHost: string; redirectIsLoopback: boolean; scope: string[] };
    profiles: { id: string; name: string; accounts: { id: string; name: string }[] }[];
    domains: string[];
}
export function Consent({ handle, run }: { handle: string; run: (action: () => Promise<void>) => Promise<void> }) {
    const [data, setData] = useState<ConsentData>();
    const [identities, setIdentities] = useState<Record<string, string[]>>({});
    const [accounts, setAccounts] = useState<Record<string, string[]>>({});
    const [domains, setDomains] = useState<string[]>([]);
    const [write, setWrite] = useState(false);
    const [pending, setPending] = useState<'authorize' | 'deny' | null>(null);
    const submitting = useRef(false);
    useEffect(() => { void run(async () => setData(await api<ConsentData>(`/consent/${encodeURIComponent(handle)}`))); }, [handle]);
    const toggle = (values: string[], value: string) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
    if (!data) return <p>Loading authorization request...</p>;
    const selectAll = () => {
        setIdentities(Object.fromEntries(data.profiles.map((profile) => [profile.id, profile.accounts.length ? ['bot', 'user'] : ['bot']])));
        setAccounts(Object.fromEntries(data.profiles.map((profile) => [profile.id, profile.accounts.map((account) => account.id)])));
        setDomains([...data.domains]);
        setWrite(data.client.scope.includes('mcp:write'));
    };
    const clearAll = () => {
        setIdentities({}); setAccounts({}); setDomains([]); setWrite(false);
    };
    const submit = (action: 'authorize' | 'deny') => {
        if (submitting.current) return;
        submitting.current = true;
        setPending(action);
        void run(async () => {
            try {
                const profiles = data.profiles.filter((profile) => identities[profile.id]?.length).map((profile) => ({ profileId: profile.id, identities: identities[profile.id], accounts: identities[profile.id]?.includes('user') ? accounts[profile.id] ?? [] : [] }));
                const result = await api<{ redirectTo: string }>(`/consent/${encodeURIComponent(handle)}`, action === 'authorize' ? 'POST' : 'DELETE',
                    action === 'authorize' ? { profiles, domains, permissions: write ? ['read', 'write'] : ['read'] } : undefined);
                location.assign(result.redirectTo);
            } catch (error) {
                submitting.current = false;
                setPending(null);
                throw error;
            }
        });
    };
    return <section><h2>Authorize MCP access</h2><h3>{data.client.clientName}</h3>
        <p>Authorization returns to <strong>{data.client.redirectHost}</strong>.</p>
        {data.client.redirectIsLoopback && <p>A local application receives the authorization code. Any process listening on that local port could receive it.</p>}
        <p>Select the applications, identities and domains this client may use.</p>
        <div className="actions"><button type="button" onClick={selectAll}>Select all</button><button type="button" onClick={clearAll}>Clear all</button></div>
        {data.profiles.map((profile) => <fieldset key={profile.id}><legend>{profile.name}</legend>
            {['bot', 'user'].map((identity) => <label className="check" key={identity}><input type="checkbox" checked={(identities[profile.id] ?? []).includes(identity)} onChange={() => setIdentities({ ...identities, [profile.id]: toggle(identities[profile.id] ?? [], identity) })} />{profile.name}: {identity} identity</label>)}
            {(identities[profile.id] ?? []).includes('user') && <>{profile.accounts.length === 0 && <p>Authorize a Lark account in Applications first.</p>}{profile.accounts.map((account) => <label className="check" key={account.id}><input type="checkbox" checked={(accounts[profile.id] ?? []).includes(account.id)} onChange={() => setAccounts({ ...accounts, [profile.id]: toggle(accounts[profile.id] ?? [], account.id) })} />{account.name}</label>)}</>}
        </fieldset>)}
        <fieldset><legend>Domains</legend>{data.domains.map((domain) => <label className="check" key={domain}><input type="checkbox" checked={domains.includes(domain)} onChange={() => setDomains(toggle(domains, domain))} />{domain}</label>)}</fieldset>
        {data.client.scope.includes('mcp:write') && <label className="check"><input type="checkbox" checked={write} onChange={(event) => setWrite(event.target.checked)} />Allow write operations</label>}
        <div className="actions"><button className="primary" disabled={pending !== null} aria-busy={pending === 'authorize'} onClick={() => submit('authorize')}>{pending === 'authorize' ? 'Authorizing...' : 'Authorize client'}</button><button disabled={pending !== null} onClick={() => submit('deny')}>{pending === 'deny' ? 'Denying...' : 'Deny'}</button></div>
    </section>;
}
