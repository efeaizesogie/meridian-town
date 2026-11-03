import { useState } from 'react';
import { join } from './near';

export function Join({ onJoined }: { onJoined: (accountId: string) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onJoined(await join(name.trim().toLowerCase()));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <p className="eyebrow">A market town that runs itself</p>
        <h1>Meridian</h1>
        <p className="lede">
          Six shops, each kept by an agent with its own purse. Gather in the Forest, the Mine and the Fields,
          sell to whoever pays best, and buy a shop when one goes under. Keep the town trading and it celebrates;
          let it stall and the treasury burns.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="name">Choose a name</label>
          <div className="row">
            <input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="ada" autoComplete="off" spellCheck={false} maxLength={20} />
            <button className="primary" disabled={busy || name.trim().length < 3}>{busy ? 'Opening your stall…' : 'Enter the town'}</button>
          </div>
          {error && <p className="error">{error}</p>}
          <p className="fine">
            No wallet needed. Your key is created in this browser and can only act in Meridian; the game pays your gas.
          </p>
        </form>
      </div>
    </div>
  );
}
