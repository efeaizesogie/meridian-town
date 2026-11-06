// Charter Meridian's guilds: one Sputnik DAO each, from the testnet factory, registered with
// the town. Signed by the town owner, who pays each DAO's storage (~6 NEAR).
//   node scripts/create-guilds.ts [owner] [town] [game]
//
// Policy, per guild:
//   council (the game's registrar)  approves join requests
//   member                          proposes and votes on transfers and function calls
//                                   (bid for a deed, share out, appoint an agent), and can amend
//                                   the policy itself by majority, so a guild can always fix it
//   (Sputnik's permission label for a function call is `call`, not `function_call`.)
//   everyone                        may ask to join
// Proposals cost no bond, so players' limited keys can propose and vote without deposits.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Account, FailoverRpcProvider, JsonRpcProvider, nearToYocto, teraToGas } from 'near-api-js';

const [owner = 'efecode.testnet', town = 'town.efecode.testnet', game = 'game.efecode.testnet'] = process.argv.slice(2);
const FACTORY = process.env.SPUTNIK_FACTORY ?? 'sputnikv2.testnet';
const DAO_DEPOSIT = process.env.DAO_DEPOSIT ?? '6';
const NETWORK = process.env.NEAR_NETWORK ?? 'testnet';
const RPCS = NETWORK === 'mainnet'
  ? ['https://rpc.mainnet.fastnear.com', 'https://rpc.mainnet.near.org']
  : ['https://near-testnet.drpc.org', 'https://testnet-rpc.intea.rs', 'https://test.rpc.fastnear.com'];
const DAY_NS = String(24n * 3600n * 1_000_000_000n);

export const GUILDS = [
  { name: 'meridian-hammer', title: 'The Hammer Guild', purpose: 'Smiths, miners and woodcutters of Meridian, pooling coin to own the shops that make the tools.' },
  { name: 'meridian-harvest', title: 'The Harvest Guild', purpose: 'Farmers and bakers of Meridian, pooling coin so the town never goes hungry.' },
];

const policy = {
  roles: [
    { name: 'council', kind: { Group: [game] }, permissions: ['add_member_to_role:VoteApprove', 'add_member_to_role:VoteReject', 'add_member_to_role:Finalize', 'remove_member_from_role:*'], vote_policy: {} },
    { name: 'member', kind: { Group: [] }, permissions: ['*:AddProposal', ...['transfer', 'call', 'policy', 'policy_add_or_update_role', 'policy_remove_role', 'policy_update_default_vote_policy', 'policy_update_parameters'].flatMap(k => [`${k}:VoteApprove`, `${k}:VoteReject`, `${k}:Finalize`])], vote_policy: {} },
    { name: 'all', kind: 'Everyone', permissions: ['add_member_to_role:AddProposal'], vote_policy: {} },
  ],
  default_vote_policy: { weight_kind: 'RoleWeight', quorum: '0', threshold: [1, 2] },
  proposal_bond: '0',
  proposal_period: DAY_NS,
  bounty_bond: '0',
  bounty_forgiveness_period: DAY_NS,
};

const key = JSON.parse(readFileSync(join(homedir(), '.near-credentials', NETWORK, `${owner}.json`), 'utf8')).private_key;
const provider = new FailoverRpcProvider(RPCS.map(url => new JsonRpcProvider({ url })));
const account = new Account(owner, provider, key);

// GUILD=<name> charters just that one (each needs ~6 NEAR of storage).
for (const g of GUILDS.filter(x => !process.env.GUILD || x.name === process.env.GUILD)) {
  const dao = `${g.name}.${FACTORY}`;
  const exists = await provider.viewAccount({ accountId: dao }).then(() => true, () => false);
  if (!exists) {
    const args = Buffer.from(JSON.stringify({ config: { name: g.name, purpose: g.purpose, metadata: Buffer.from(JSON.stringify({ title: g.title, town })).toString('base64') }, policy })).toString('base64');
    await account.callFunction({ contractId: FACTORY, methodName: 'create', args: { name: g.name, args }, deposit: nearToYocto(DAO_DEPOSIT), gas: teraToGas(300) });
    console.log(`created ${dao}`);
  } else {
    console.log(`${dao} already exists`);
  }
  await account.callFunction({ contractId: town, methodName: 'register_guild', args: { guild: dao }, gas: teraToGas(30) });
  console.log(`registered ${dao} with ${town}`);
}
