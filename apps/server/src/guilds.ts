// Guilds: Sputnik DAOs chartered by the town (scripts/create-guilds.ts). The server reads
// each guild's members, treasury and recent proposals for the client, and runs the guild
// registrar: it holds the council seat and approves players' own requests to join.
import { teraToGas } from 'near-api-js';
import { game, rpc, view } from './chain.ts';
import * as players from './players.ts';

export interface GuildView {
  id: string;
  title: string;
  purpose: string;
  members: string[];
  treasury: string;
  proposals: any[];
}

async function viewAt<T>(contract: string, method: string, args: object = {}): Promise<T> {
  const body = await rpc('query', { request_type: 'call_function', finality: 'optimistic', account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  if (body.error || body.result?.error) throw new Error(JSON.stringify(body.error ?? body.result.error));
  return JSON.parse(Buffer.from(body.result.result).toString());
}

export async function readGuilds(ids: string[]): Promise<GuildView[]> {
  return Promise.all(ids.map(async id => {
    const [config, policy, treasury, last] = await Promise.all([
      viewAt<any>(id, 'get_config'),
      viewAt<any>(id, 'get_policy'),
      view<string>('ft_balance_of', { account_id: id }),
      viewAt<number>(id, 'get_last_proposal_id'),
    ]);
    const from = Math.max(0, last - 12);
    const proposals = last > 0 ? await viewAt<any[]>(id, 'get_proposals', { from_index: from, limit: 12 }) : [];
    let meta: any = {};
    try {
      meta = JSON.parse(Buffer.from(config.metadata ?? '', 'base64').toString() || '{}');
    } catch {}
    const memberRole = policy.roles.find((r: any) => r.name === 'member');
    return {
      id,
      title: meta.title ?? config.name,
      purpose: config.purpose,
      members: memberRole?.kind?.Group ?? [],
      treasury,
      proposals: proposals.reverse(),
    };
  }));
}

/** Approve requests where a known player asks to join as themselves. */
export async function runRegistrar(guilds: GuildView[]) {
  for (const g of guilds) {
    for (const p of g.proposals) {
      const add = p.kind?.AddMemberToRole;
      if (p.status !== 'InProgress' || !add || add.role !== 'member') continue;
      if (add.member_id !== p.proposer || !players.get(add.member_id) || g.members.includes(add.member_id)) continue;
      try {
        await game.callFunction({ contractId: g.id, methodName: 'act_proposal', args: { id: p.id, action: 'VoteApprove', proposal: p.kind }, gas: teraToGas(100) });
        console.log(`[registrar] ${add.member_id} joined ${g.title}`);
      } catch (e) {
        console.error(`[registrar] ${g.id} #${p.id}:`, e instanceof Error ? e.message.slice(0, 160) : e);
      }
    }
  }
}
