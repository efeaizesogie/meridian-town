// The guild hall: Sputnik DAOs players join to pool MERI, own shops together and vote on
// what to do with the treasury. Every proposal and vote is a transaction on the guild's DAO.
import { useState } from 'react';
import type { Act, World } from './App';
import { call, canUseGuild, guildCall } from './near';
import { fmt, short, type GuildView } from './types';

const b64 = (o: object) => btoa(JSON.stringify(o));

/** Plain words for a proposal's kind. */
function describe(kind: any, world: World): string {
  if (kind?.AddMemberToRole) return `${short(kind.AddMemberToRole.member_id)} asks to join`;
  const fc = kind?.FunctionCall;
  if (fc) {
    const a = fc.actions?.[0];
    let args: any = {};
    try {
      args = JSON.parse(atob(a.args));
    } catch {}
    if (a?.method_name === 'bid_for_deed') return `Bid ${fmt(args.amount)} MERI for ${world.shops.find(s => s.shop.id === args.shop_id)?.shop.name ?? args.shop_id}`;
    if (a?.method_name === 'share_out') return `Share out ${fmt(args.recipients?.reduce((t: bigint, r: [string, string]) => t + BigInt(r[1]), 0n) ?? 0)} MERI to ${args.recipients?.length} members`;
    if (a?.method_name === 'set_agent') return `Appoint ${args.agent ? short(args.agent) : 'no one'} to run ${args.shop_id}`;
    return `Call ${a?.method_name}`;
  }
  return Object.keys(kind ?? {})[0] ?? 'Proposal';
}

export function GuildHall({ world, account, busy, act, town }: { world: World; account: string; busy: string | null; act: Act; town: string }) {
  const guilds = world.guildViews ?? [];
  const [open, setOpen] = useState<string | null>(null);
  if (!guilds.length) {
    return (
      <div className="panel">
        <h2 className="section-title">Guild hall</h2>
        <p className="empty-note">The guilds haven’t been chartered yet.</p>
      </div>
    );
  }
  return (
    <div className="panel">
      <h2 className="section-title">Guild hall</h2>
      <p className="hint">Guilds are DAOs. Members pool MERI, vote to buy shops together, and share out what they earn. A majority of members decides.</p>
      {guilds.map(g => (
        <Guild key={g.id} g={g} world={world} account={account} busy={busy} act={act} town={town} expanded={open === g.id} onToggle={() => setOpen(open === g.id ? null : g.id)} />
      ))}
    </div>
  );
}

function Guild({ g, world, account, busy, act, town, expanded, onToggle }: {
  g: GuildView; world: World; account: string; busy: string | null; act: Act; town: string; expanded: boolean; onToggle: () => void;
}) {
  const member = g.members.includes(account);
  const pendingJoin = g.proposals.some(p => p.status === 'InProgress' && p.kind?.AddMemberToRole?.member_id === account);
  const usable = canUseGuild(g.id);
  const deeds = world.shops.filter(s => s.deed_holder === g.id);
  const [contrib, setContrib] = useState('20');
  const [bidShop, setBidShop] = useState(world.shops[0]?.shop.id ?? '');
  const [bidAmount, setBidAmount] = useState('350');
  const [share, setShare] = useState('');

  const propose = (label: string, description: string, kind: object) =>
    act(label, async () => {
      await guildCall(g.id, 'add_proposal', { proposal: { description, kind } }, 30);
      return `Proposed to ${g.title}: ${description}.`;
    });
  const fnCall = (method: string, args: object) => ({
    FunctionCall: { receiver_id: town, actions: [{ method_name: method, args: b64(args), deposit: '0', gas: '35000000000000' }] },
  });

  return (
    <div className="guild">
      <button className="guild-head" onClick={onToggle} aria-expanded={expanded}>
        <span>
          <strong>{g.title}</strong>
          <span className="muted"> {g.members.length} member{g.members.length === 1 ? '' : 's'}, {fmt(g.treasury, 0)} MERI{deeds.length ? `, owns ${deeds.map(d => d.shop.name).join(', ')}` : ''}</span>
        </span>
        {member ? <span className="status open">member</span> : <span className="muted">{expanded ? '▴' : '▾'}</span>}
      </button>
      {expanded && (
        <div className="guild-body">
          <p className="muted">{g.purpose}</p>
          {!usable && <p className="hint">This character joined before the guilds opened, so it has no guild key. New characters get one automatically.</p>}
          {usable && !member && (
            <button className="small primary" disabled={!!busy || pendingJoin} onClick={() => propose('Join', `${short(account)} asks to join`, { AddMemberToRole: { member_id: account, role: 'member' } })}>
              {pendingJoin ? 'Waiting for the registrar…' : 'Ask to join'}
            </button>
          )}
          {usable && member && (
            <>
              <div className="row">
                <input className="small" inputMode="decimal" value={contrib} onChange={e => setContrib(e.target.value)} aria-label="MERI to contribute" />
                <button className="small" disabled={!!busy} onClick={() => act('Contribute', async () => {
                  await call('pay_guild', { guild: g.id, amount: String(Math.round(Number(contrib) * 1e6)) });
                  return `You paid ${contrib} MERI into ${g.title}.`;
                })}>Pay into treasury</button>
              </div>
              <div className="row">
                <select value={bidShop} onChange={e => setBidShop(e.target.value)} aria-label="Shop">
                  {world.shops.map(s => <option key={s.shop.id} value={s.shop.id}>{s.shop.name}</option>)}
                </select>
                <input className="small" inputMode="decimal" value={bidAmount} onChange={e => setBidAmount(e.target.value)} aria-label="Bid amount" />
                <button className="small" disabled={!!busy} onClick={() => {
                  const name = world.shops.find(s => s.shop.id === bidShop)?.shop.name;
                  propose('Propose', `Bid ${bidAmount} MERI for ${name}`, fnCall('bid_for_deed', { shop_id: bidShop, amount: String(Math.round(Number(bidAmount) * 1e6)) }));
                }}>Propose a deed bid</button>
              </div>
              <div className="row">
                <input className="small" inputMode="decimal" placeholder="MERI" value={share} onChange={e => setShare(e.target.value)} aria-label="MERI to share out" />
                <button className="small" disabled={!!busy || !Number(share)} onClick={() => {
                  const each = BigInt(Math.floor((Number(share) * 1e6) / g.members.length));
                  propose('Propose', `Share out ${share} MERI equally`, fnCall('share_out', { recipients: g.members.map(m => [m, String(each)]) }));
                }}>Propose a share-out</button>
              </div>
            </>
          )}
          <h4>Proposals</h4>
          {g.proposals.length === 0 && <p className="empty-note">None yet.</p>}
          <ul className="proposals">
            {g.proposals.slice(0, 8).map(p => {
              const yes = Object.values(p.votes ?? {}).filter(v => v === 'Approve').length;
              const no = Object.values(p.votes ?? {}).filter(v => v === 'Reject').length;
              const voted = p.votes?.[account];
              const canVote = member && usable && p.status === 'InProgress' && !voted && !p.kind?.AddMemberToRole;
              return (
                <li key={p.id}>
                  <div>
                    <span className={`status ${p.status === 'Approved' ? 'open' : p.status === 'InProgress' ? 'at-auction' : 'closed'}`}>{p.status === 'InProgress' ? 'voting' : p.status.toLowerCase()}</span>{' '}
                    {describe(p.kind, world)}
                    <div className="muted">Proposal {p.id} by {short(p.proposer)}: {yes} for, {no} against{voted ? `. You voted ${voted.toLowerCase()}` : ''}</div>
                  </div>
                  {canVote && (
                    <div className="row">
                      <button className="small primary" disabled={!!busy} onClick={() => act('Vote', async () => { await guildCall(g.id, 'act_proposal', { id: p.id, action: 'VoteApprove', proposal: p.kind }, 70); return `You voted for proposal ${p.id}.`; })}>For</button>
                      <button className="small" disabled={!!busy} onClick={() => act('Vote', async () => { await guildCall(g.id, 'act_proposal', { id: p.id, action: 'VoteReject', proposal: p.kind }, 70); return `You voted against proposal ${p.id}.`; })}>Against</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <a className="muted" href={`https://testnet.nearblocks.io/address/${g.id}`} target="_blank" rel="noreferrer">{g.id} on the explorer</a>
        </div>
      )}
    </div>
  );
}
