import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, setCsrf } from './api';
import './style.css';
import { ProfileCard } from './profile-card';
import { Consent } from './consent';
import { Grants } from './grants';
import { ManagementTabs, panelId, tabId, type ManagementSection } from './management-tabs';

interface Profile { id: string; name: string; brand: string; appId: string }

function App() {
    const [signedIn, setSignedIn] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [tab, setTab] = useState<ManagementSection>('Applications');
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [name, setName] = useState('');
    const [brand, setBrand] = useState('lark');
    const [appId, setAppId] = useState('');
    const [appSecret, setAppSecret] = useState('');
    const [usage, setUsage] = useState({ bytes: 0, classA: 0, classB: 0 });
    const consentHandle = new URLSearchParams(location.search).get('handle');

    const refresh = async () => {
        const [applications, storage] = await Promise.all([
            api<{ profiles: Profile[] }>('/profiles'), api<typeof usage>('/usage'),
        ]);
        setProfiles(applications.profiles); setUsage(storage);
    };
    const run = async (action: () => Promise<void>) => {
        setBusy(true); setError('');
        try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'The request failed.'); }
        finally { setBusy(false); }
    };
    useEffect(() => { void api<{ csrf: string }>('/session').then(async (session) => {
        setCsrf(session.csrf); setSignedIn(true); await refresh();
    }).catch(() => {}); }, []);

    return <main>
        <header><div className="brand"><img className="brand-icon" src="/favicon.png" alt="" width="44" height="44" /><div><p className="eyebrow">PRIVATE WORKSPACE</p><h1>Lark MCP</h1><p className="subtitle">Applications, accounts and access in one place.</p></div></div>
            {signedIn && <button onClick={() => void run(async () => {
                const result = await api<{ redirectTo: string }>('/logout', 'POST');
                setCsrf(''); setSignedIn(false); location.assign(result.redirectTo);
            })}>Sign out</button>}
        </header>
        {error && <p className="error" role="alert">{error}</p>}
        {!signedIn ? <section className="login"><h2>Management sign in</h2><p>Sign in with your @tenfy.cn email.</p>
            <a className="primary access-sign-in" href={'/api/admin/access-login?returnTo=' + encodeURIComponent(location.pathname + location.search)}>Sign in with Cloudflare Access</a>
        </section> : <>
            <ManagementTabs selected={tab} onSelect={setTab} />
            <p className="endpoint"><span>MCP endpoint</span><code>{location.origin}/mcp</code></p>
            {consentHandle && <Consent handle={consentHandle} run={run} />}
            <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} tabIndex={0}>
            {tab === 'Applications' ? <section><h2>Applications</h2><p>Each application keeps its credentials and authorized accounts separate.</p>
                <form className="grid" onSubmit={(event) => { event.preventDefault(); void run(async () => {
                    const value = appSecret; setAppSecret('');
                    await api('/profiles', 'POST', { name, brand, appId, appSecret: value });
                    setName(''); setAppId(''); await refresh();
                }); }}>
                    <label>Profile name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
                    <label>Platform<select value={brand} onChange={(event) => setBrand(event.target.value)}><option value="lark">Lark</option><option value="feishu">Feishu</option></select></label>
                    <label>App ID<input value={appId} onChange={(event) => setAppId(event.target.value)} required /></label>
                    <label>App Secret<input type="password" autoComplete="new-password" value={appSecret} onChange={(event) => setAppSecret(event.target.value)} required /></label>
                    <button className="primary" disabled={busy}>Add application</button>
                </form>
                <div className="cards">{profiles.map((profile) => <ProfileCard key={profile.id} profile={profile} refresh={refresh} run={run} />)}</div>
                {!profiles.length && <p>No applications yet. Add one to begin.</p>}
            </section> : tab === 'Storage' ? <section><h2>Temporary storage</h2><dl><dt>Used</dt><dd>{usage.bytes.toLocaleString('en-US')} bytes</dd><dt>Default capacity</dt><dd>2,000,000,000 bytes</dd><dt>Class A operations this month</dt><dd>{usage.classA.toLocaleString('en-US')} / 100,000</dd><dt>Class B operations this month</dt><dd>{usage.classB.toLocaleString('en-US')} / 1,000,000</dd></dl><p>Files expire after 24 hours. Incomplete uploads retain their reservations until cleanup.</p><button onClick={() => void run(refresh)}>Refresh usage</button></section> : <Grants run={run} />}
            </div>
        </>}
    </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
