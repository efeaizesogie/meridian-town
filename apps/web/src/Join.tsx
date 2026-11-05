// Sign in: a new character (with recovery words to save), or back in with your words or a saved key.
import { useState } from 'react';
import { SavePhrase } from './Account';
import { backup, join, restoreWithKey, restoreWithPhrase } from './near';

export function Join({ onJoined }: { onJoined: (accountId: string, isNew: boolean) => void }) {
  const [mode, setMode] = useState<'new' | 'back'>('new');
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ accountId: string; phrase: string } | null>(null);

  const run = (task: () => Promise<void>) => async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const create = run(async () => {
    const id = await join(name.trim().toLowerCase());
    setMade({ accountId: id, phrase: backup()?.phrase ?? '' });
  });
  const restore = run(async () => {
    const words = secret.trim();
    const id = words.startsWith('ed25519:') ? await restoreWithKey(name, words) : await restoreWithPhrase(name, words);
    onJoined(id, false);
  });

  if (made) return <SavePhrase accountId={made.accountId} phrase={made.phrase} onDone={() => onJoined(made.accountId, true)} />;

  return (
    <div className="gate">
      <div className="gate-card">
        <a className="gate-back" href="/">Meridian</a>
        <div className="tabs" role="tablist" aria-label="Sign in">
          <button role="tab" aria-selected={mode === 'new'} className={mode === 'new' ? 'on' : ''} onClick={() => { setMode('new'); setError(null); }}>New here</button>
          <button role="tab" aria-selected={mode === 'back'} className={mode === 'back' ? 'on' : ''} onClick={() => { setMode('back'); setError(null); }}>Welcome back</button>
        </div>

        {mode === 'new' ? (
          <>
            <h1>Pick your name</h1>
            <p className="lede">It goes on your stall, your deeds and the leaderboard.</p>
            <form onSubmit={create}>
              <label htmlFor="name" className="visually-hidden">Your name</label>
              <div className="row">
                <input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="ada" autoComplete="off" spellCheck={false} maxLength={20} />
                <button className="primary" disabled={busy || name.trim().length < 3}>{busy ? 'Opening your stall…' : 'Enter the town'}</button>
              </div>
              {error && <p className="error">{error}</p>}
              <p className="fine">No wallet needed, and the game pays your gas. You’ll get 12 recovery words that make the account yours.</p>
            </form>
          </>
        ) : (
          <>
            <h1>Back to your stall</h1>
            <p className="lede">Your coins, goods and shops are waiting on chain.</p>
            <form onSubmit={restore} className="stack-form">
              <label htmlFor="back-name">Your name</label>
              <input id="back-name" value={name} onChange={e => setName(e.target.value)} placeholder="ada" autoComplete="username" spellCheck={false} />
              <label htmlFor="back-secret">Your 12 recovery words, or a saved key</label>
              <textarea id="back-secret" value={secret} onChange={e => setSecret(e.target.value)} rows={3} placeholder="apple river …" autoComplete="off" spellCheck={false} />
              <button className="primary" disabled={busy || name.trim().length < 2 || secret.trim().length < 20}>{busy ? 'Finding your account…' : 'Log in'}</button>
              {error && <p className="error">{error}</p>}
              <p className="fine">Your words never leave this browser. They sign one transaction that gives this browser a key to play with.</p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
