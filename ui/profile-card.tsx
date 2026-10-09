import { useEffect, useState } from 'react';
import { api } from './api';
import { ScopeList } from './scope-list';

interface Account { id: string; name: string; scopes: string[] }
interface Flow { id: string; status: string; verificationUri?: string; nextPollAt?: number }
export function ProfileCard({ profile, refresh, run }: {
    profile: { id: string; name: string; brand: string; appId: string };
    refresh: () => Promise<void>; run: (action: () => Promise<void>) => Promise<void>;
}) {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [flow, setFlow] = useState<Flow>();
    const [secret, setSecret] = useState('');
    const load = async () => setAccounts((await api<{ accounts: Account[] }>(`/profiles/${profile.id}/accounts`)).accounts);
    useEffect(() => { void run(load); }, [profile.id]);
    return <article>
        <h3>{profile.name}</h3><p>{profile.brand} · {profile.appId}</p>
        <form onSubmit={(event) => { event.preventDefault(); void run(async () => {
            setFlow(await api<Flow>(`/profiles/${profile.id}/login`, 'POST'));
        }); }}>
            <p>Authorization requests all user permissions currently enabled for this application.</p>
            <button>Authorize account</button>
        </form>
        {flow?.status === 'pending' && <div className="flow">
            <p><a href={flow.verificationUri} target="_blank" rel="noreferrer">Open Lark authorization</a></p>
            <p>Next check: {new Date(flow.nextPollAt ?? 0).toLocaleTimeString()}</p>
            <button onClick={() => void run(async () => { const result = await api<Flow>(`/flows/${flow.id}/poll`, 'POST'); setFlow(result); if (result.status === 'authorized') await load(); })}>Check authorization</button>
            <button onClick={() => void run(async () => { await api(`/flows/${flow.id}`, 'DELETE'); setFlow(undefined); })}>Cancel authorization</button>
        </div>}
        {flow?.status === 'authorized' && <p role="status">Authorization complete.</p>}
        {flow && !['pending', 'authorized'].includes(flow.status) && <p role="status">Authorization {flow.status}. Start again to retry.</p>}
        {accounts.map((account) => <div key={account.id}><p>{account.name} <code>{account.id}</code></p><ScopeList scopes={account.scopes} />
            <button onClick={() => void run(async () => { await api(`/profiles/${profile.id}/accounts/${account.id}`, 'DELETE'); await load(); })}>Sign out {account.name}</button>
        </div>)}
        <details><summary>Manage credentials</summary>
            <form onSubmit={(event) => { event.preventDefault(); void run(async () => { const value = secret; setSecret(''); await api(`/profiles/${profile.id}`, 'PATCH', { appSecret: value }); await refresh(); }); }}>
                <label>Replacement App Secret<input type="password" autoComplete="new-password" required value={secret} onChange={(event) => setSecret(event.target.value)} /></label>
                <button>Rotate secret</button>
            </form>
            <button onClick={() => void run(async () => { if (confirm(`Remove ${profile.name} and all its stored accounts?`)) { await api(`/profiles/${profile.id}`, 'DELETE'); await refresh(); } })}>Remove application</button>
        </details>
    </article>;
}
