// Merchant agents. Each shop is run by an agent with its own NEAR account (0.15 NEAR for gas) whose only key
// can call set_target, post_job and expire_job on the town, nothing else. Every tick the
// agent looks at its shop, decides, acts on chain, and says why.
//
// Decisions come from a fixed strategy (always available) and, when NEARAI_API_KEY is set,
// from an LLM on NEAR AI Cloud that sees the same state and the same limits. Whatever the
// LLM proposes is checked against those limits here, and again by the contract.
import { teraToGas } from 'near-api-js';
import { TOWN } from './chain.ts';
import { KeyStore, withRetries } from './accounts.ts';

const ITEMS = ['wood', 'ore', 'wheat', 'bread', 'tool'] as const;
type Item = (typeof ITEMS)[number];
const RAW: Item[] = ['wood', 'ore', 'wheat'];

const LLM_URL = process.env.AGENT_LLM_URL ?? 'https://cloud-api.near.ai/v1/chat/completions';
const LLM_KEY = process.env.NEARAI_API_KEY ?? process.env.AGENT_LLM_KEY;
// GLM 5.3 Flash: hosted by NEAR AI, 6/6 valid decisions in dry runs, ~$0.0003 per decision.
const LLM_MODEL = process.env.AGENT_LLM_MODEL ?? 'z-ai/glm-5.3-flash';
const TICK_MS = Number(process.env.AGENT_TICK_MS ?? 60_000);
const SPEAK_EVERY_MS = Number(process.env.AGENT_SPEAK_MS ?? 10 * 60_000);
const AGENT_METHODS = ['set_target', 'post_job', 'expire_job'];

/** `lines` is how each keeper talks when the strategy rules decide (no LLM). */
export const PERSONAS: Record<string, { keeper: string; voice: string; lines: { short: string; glut: string; steady: string } }> = {
  lumberyard: { keeper: 'brann', voice: 'Brann, a gruff old lumberman of few words who distrusts anyone in a hurry',
    lines: { short: 'Yard’s bare.', glut: 'Too much timber in the yard.', steady: 'Wood’s stacked. Nothing to say.' } },
  mine: { keeper: 'petra', voice: 'Petra, a shrewd mine clerk who counts every coin and loves a bargain',
    lines: { short: 'The ledger says we’re short.', glut: 'Ore’s cheap today, and I know it.', steady: 'Prices are fair. For now.' } },
  granary: { keeper: 'wen', voice: 'Wen, a patient granary keeper who thinks in seasons and worries about famine',
    lines: { short: 'The granary echoes. A bad sign.', glut: 'Grain to the rafters.', steady: 'Full bins, calm heart.' } },
  smith: { keeper: 'hilde', voice: 'Hilde, a proud blacksmith who hates a cold forge and speaks bluntly',
    lines: { short: 'The forge is cold!', glut: 'Too many tools on the rack.', steady: 'The forge burns steady.' } },
  baker: { keeper: 'oswin', voice: 'Oswin, a cheerful baker who frets when the ovens sit idle',
    lines: { short: 'The ovens are idle. Oh dear!', glut: 'Bread everywhere, help yourselves!', steady: 'Ovens warm, loaves rising.' } },
  store: { keeper: 'mabel', voice: 'Mabel, a gossipy shopkeeper who knows everyone’s business',
    lines: { short: 'Shelves are bare and people are talking.', glut: 'I can’t give these away!', steady: 'Everyone’s buying, and I hear everything.' } },
};

// ---------- accounts: one per shop, key limited to AGENT_METHODS ----------

const store = new KeyStore('agents.json');

/** The agent account for a shop: `<keeper>.<game>`, or the name it was created under. */
export const agentAccount = (shopId: string) => store.accountId(shopId, PERSONAS[shopId].keeper);

export async function ensureAgentAccounts() {
  for (const shopId of Object.keys(PERSONAS)) await store.ensure(shopId, PERSONAS[shopId].keeper, AGENT_METHODS);
}

// ---------- what an agent sees and may do ----------

interface ShopView {
  shop: { id: string; name: string; buys: Item[]; sells: Item[]; target: number[]; genesis_target: number[]; open: boolean; agent: string | null };
  cash: string;
  stock: number[];
  ask: string[];
  bid: string[];
}
interface Job { id: number; shop_id: string; item: Item; remaining: number; unit_price: string; deadline_ns: number }

type Action =
  | { type: 'set_target'; item: Item; target: number }
  | { type: 'post_job'; item: Item; quantity: number; unit_price: string; hours: number }
  | { type: 'expire_job'; job_id: number };

interface Decision {
  say: string;
  reasoning: string;
  actions: Action[];
}

export interface AgentReport {
  shopId: string;
  accountId: string;
  mode: 'llm' | 'rules';
  say: string;
  reasoning: string;
  acted: { what: string; tx?: string; error?: string }[];
  at: number;
}

const reports: Record<string, AgentReport> = {};
export const getReports = () => reports;

const m = (micro: string | number) => (Number(micro) / 1e6).toFixed(2);

/** The limits the contract enforces, computed here so agents only propose valid moves. */
function limits(s: ShopView, item: Item, params: { job_trigger_bps: number; job_premium_bps: number; agent_target_band_bps: number }) {
  const i = ITEMS.indexOf(item);
  const g = s.shop.genesis_target[i];
  const band = Math.floor((g * params.agent_target_band_bps) / 10_000);
  const stock = s.stock[i];
  const target = s.shop.target[i];
  const maxPrice = (BigInt(s.bid[i]) * BigInt(10_000 + params.job_premium_bps)) / 10_000n;
  return {
    stock, target, genesis: g, minTarget: g - band, maxTarget: g + band,
    jobAllowed: RAW.includes(item) && s.shop.buys.includes(item) && stock * 10_000 < target * params.job_trigger_bps,
    maxJobQty: Math.max(0, Math.floor((target * 6) / 10) - stock),
    maxJobPrice: maxPrice,
  };
}

/** The always-on strategy: chase inputs when short, discount gluts, drift home otherwise. */
export function decideByRules(s: ShopView, jobs: Job[], params: any): Decision {
  const acts: Action[] = [];
  const notes: string[] = [];
  const traded = ITEMS.filter(i => s.shop.genesis_target[ITEMS.indexOf(i)] > 0);
  for (const item of traded) {
    const L = limits(s, item, params);
    const step = Math.max(1, Math.ceil(L.genesis / 10));
    const open = jobs.find(j => j.shop_id === s.shop.id && j.item === item);
    if (L.jobAllowed && !open && L.maxJobQty > 0 && L.maxJobPrice > 0n) {
      const price = (L.maxJobPrice * 98n) / 100n;
      const qty = Math.min(L.maxJobQty, Number((BigInt(s.cash) / 2n) / (price || 1n)));
      if (qty > 0) {
        acts.push({ type: 'post_job', item, quantity: qty, unit_price: String(price), hours: 1 });
        notes.push(`${item} down to ${L.stock}/${L.target}: posting ${qty} at ${m(price)}`);
      }
    }
    let next = L.target;
    if (L.stock < L.target * 0.5) next = Math.min(L.maxTarget, L.target + step);
    else if (L.stock > L.target * 2) next = Math.max(L.minTarget, L.target - step);
    else if (L.target !== L.genesis && L.stock >= L.target * 0.8 && L.stock <= L.target * 1.5) next = L.target + Math.sign(L.genesis - L.target) * Math.min(step, Math.abs(L.genesis - L.target));
    if (next !== L.target) {
      acts.push({ type: 'set_target', item, target: next });
      notes.push(`${item} target ${L.target}→${next} (${next > L.target ? 'short, paying more' : next < L.target ? 'glutted, cheaper' : 'settling'})`);
    }
  }
  const now = Date.now() * 1e6;
  for (const j of jobs.filter(j => j.shop_id === s.shop.id && j.deadline_ns < now)) {
    acts.push({ type: 'expire_job', job_id: j.id });
    notes.push(`contract #${j.id} expired, reclaiming escrow`);
  }
  const lines = PERSONAS[s.shop.id].lines;
  const job = acts.find(a => a.type === 'post_job') as Extract<Action, { type: 'post_job' }> | undefined;
  const cut = acts.find(a => a.type === 'set_target' && a.target < s.shop.target[ITEMS.indexOf(a.item)]) as Extract<Action, { type: 'set_target' }> | undefined;
  const raise = acts.find(a => a.type === 'set_target' && a.target > s.shop.target[ITEMS.indexOf(a.item)]) as Extract<Action, { type: 'set_target' }> | undefined;
  const say = job
    ? `${lines.short} ${m(job.unit_price)} a piece for ${job.quantity} ${job.item}, and the money’s already in escrow.`
    : raise
      ? `${lines.short} Paying more for ${raise.item} until it comes in.`
      : cut
        ? `${lines.glut} ${cut.item[0].toUpperCase() + cut.item.slice(1)} is going cheaper.`
        : lines.steady;
  return { say, reasoning: notes.join('; ') || 'Stock near target on everything; holding prices.', actions: acts };
}

/** Ask the LLM to decide in character, within the same limits. Returns null on any failure. */
export async function decideByLLM(s: ShopView, jobs: Job[], params: any, town: any, suggestion: Decision, usage?: { tokens: number }): Promise<Decision | null> {
  if (!LLM_KEY) return null;
  return (await askLLM(s, jobs, params, town, suggestion, usage)) ?? (await askLLM(s, jobs, params, town, suggestion, usage));
}

async function askLLM(s: ShopView, jobs: Job[], params: any, town: any, suggestion: Decision, usage?: { tokens: number }): Promise<Decision | null> {
  const traded = ITEMS.filter(i => s.shop.genesis_target[ITEMS.indexOf(i)] > 0);
  const state = {
    shop: s.shop.name,
    cash_meri: m(s.cash),
    goods: traded.map(item => {
      const L = limits(s, item, params);
      const i = ITEMS.indexOf(item);
      return {
        item, stock: L.stock, target: L.target, target_allowed: [L.minTarget, L.maxTarget],
        situation: L.stock < L.target * 0.5 ? 'short' : L.stock > L.target * 2 ? 'glutted' : 'near target',
        you_buy: s.shop.buys.includes(item), you_sell: s.shop.sells.includes(item),
        your_bid: m(s.bid[i]), your_ask: m(s.ask[i]),
        contract_allowed: L.jobAllowed, contract_max_quantity: L.maxJobQty, contract_max_unit_price_micro: String(L.maxJobPrice),
      };
    }),
    your_open_contracts: jobs.filter(j => j.shop_id === s.shop.id).map(j => ({ id: j.id, item: j.item, remaining: j.remaining, expired: j.deadline_ns < Date.now() * 1e6 })),
    town: { day: town.day, festival_progress: `${m(town.week_counted)}/${m(town.week_target)}` },
  };
  const system = `You are ${PERSONAS[s.shop.id].voice}, running a shop in Meridian Town, a market game on NEAR.
Prices follow a fixed rule: price = base × (2·target ÷ (stock + target))². Your target moves BOTH of your prices at once: raising it makes you pay more for what you buy AND charge more for what you sell.
So: when a good is "short" and you need it, raise its target or post a contract. When a good is "glutted", lower its target so it moves and you stop buying more. Never raise the target of a glutted good.
You may only: set_target (within target_allowed), post_job (a delivery contract for a raw good you buy, only where contract_allowed, quantity ≤ contract_max_quantity, unit_price_micro ≤ contract_max_unit_price_micro, hours 1), expire_job (your expired contracts). You may also do nothing.
Keep your shop solvent: upkeep is 25 MERI a day and you close after two missed days.
Your "say" line must describe only the actions in your actions list; if you do nothing, say that in character. You can't post a second contract for a good that already has one open.
Reply with JSON only: {"say": "<one line in character, under 140 characters, to show players>", "reasoning": "<one plain sentence>", "actions": [ ... ]}.
Action shapes: {"type":"set_target","item":"ore","target":33} | {"type":"post_job","item":"ore","quantity":12,"unit_price":"<micro-MERI string>","hours":1} | {"type":"expire_job","job_id":4}`;
  try {
    const res = await fetch(LLM_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${LLM_KEY}` },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0.7,
        // Hidden reasoning shares this budget; keep effort low so the JSON isn't cut off.
        max_tokens: 4000,
        reasoning_effort: process.env.AGENT_REASONING_EFFORT ?? 'low',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Your shop right now:\n${JSON.stringify(state, null, 1)}\n\nA cautious clerk suggests: ${JSON.stringify(suggestion.actions)}. Decide.` },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    if (usage) usage.tokens += body.usage?.total_tokens ?? 0;
    const text: string = body.choices?.[0]?.message?.content ?? '';
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const d = JSON.parse(json) as Decision;
    const proposed = Array.isArray(d.actions) ? d.actions : [];
    const allowed = validate(s, jobs, params, proposed);
    const refused = proposed.length - allowed.length;
    return {
      say: String(d.say ?? '').slice(0, 180),
      reasoning: String(d.reasoning ?? '').slice(0, 300) + (refused ? ` (${refused} proposed move${refused > 1 ? 's were' : ' was'} outside its limits and refused.)` : ''),
      actions: allowed,
    };
  } catch (e) {
    console.warn(`LLM decision for ${s.shop.id} failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Drop anything outside the limits, so a confused model can't waste gas on reverts. */
function validate(s: ShopView, jobs: Job[], params: any, proposed: Action[]): Action[] {
  const ok: Action[] = [];
  for (const a of proposed.slice(0, 6)) {
    if (a.type === 'set_target' && ITEMS.includes(a.item)) {
      const L = limits(s, a.item, params);
      const target = Math.max(L.minTarget, Math.min(L.maxTarget, Math.round(a.target)));
      if (L.genesis > 0 && target !== L.target) ok.push({ ...a, target });
    } else if (a.type === 'post_job' && ITEMS.includes(a.item)) {
      const L = limits(s, a.item, params);
      const price = BigInt(String(a.unit_price ?? '0').split('.')[0] || '0');
      const qty = Math.min(L.maxJobQty, Math.floor(a.quantity));
      if (L.jobAllowed && qty > 0 && price > 0n && price <= L.maxJobPrice && !jobs.some(j => j.shop_id === s.shop.id && j.item === a.item)) {
        ok.push({ type: 'post_job', item: a.item, quantity: qty, unit_price: String(price), hours: 1 });
      }
    } else if (a.type === 'expire_job' && jobs.some(j => j.id === a.job_id && j.shop_id === s.shop.id && j.deadline_ns < Date.now() * 1e6)) {
      ok.push(a);
    }
  }
  return ok;
}

// ---------- the loop ----------

const describe = (a: Action) =>
  a.type === 'set_target' ? `set ${a.item} target to ${a.target}`
  : a.type === 'post_job' ? `posted a contract for ${a.quantity} ${a.item} at ${m(a.unit_price)}`
  : `expired contract #${a.job_id}`;

let readWorld: () => { shops: ShopView[]; jobs: Job[]; params: any; town: any } | null = () => null;

async function tick() {
  const w = readWorld();
  if (!w) return;
  const { shops, jobs, params, town } = w;
  await Promise.all(shops.map(async s => {
    const shopId = s.shop.id;
    if (!store.ready(shopId) || s.shop.agent !== agentAccount(shopId) || !s.shop.open) return;
    const rules = decideByRules(s, jobs, params);
    const last = reports[shopId];
    const wantsToSpeak = !last || Date.now() - last.at > SPEAK_EVERY_MS;
    if (!rules.actions.length && !wantsToSpeak) return;
    const llm = await decideByLLM(s, jobs, params, town, rules);
    const d = llm ?? rules;
    const acted: AgentReport['acted'] = [];
    for (const a of d.actions) {
      const args = a.type === 'set_target' ? { shop_id: shopId, item: a.item, target: a.target }
        : a.type === 'post_job' ? { shop_id: shopId, item: a.item, quantity: a.quantity, unit_price: a.unit_price, hours: a.hours }
        : { job_id: a.job_id };
      try {
        const res: any = await store.signer(shopId).callFunctionRaw({ contractId: TOWN, methodName: a.type, args, gas: teraToGas(30) });
        acted.push({ what: describe(a), tx: res.transaction.hash });
      } catch (e) {
        acted.push({ what: describe(a), error: (e instanceof Error ? e.message : String(e)).slice(0, 160) });
      }
    }
    reports[shopId] = { shopId, accountId: agentAccount(shopId), mode: llm ? 'llm' : 'rules', say: d.say, reasoning: d.reasoning, acted, at: Date.now() };
    if (acted.length) console.log(`[agent ${shopId}] ${acted.map(a => a.what + (a.error ? ` FAILED: ${a.error}` : '')).join('; ')}`);
  }));
}

export async function startAgents(world: typeof readWorld) {
  readWorld = world;
  if (process.env.AGENTS === 'off') return;
  await withRetries('agent accounts', ensureAgentAccounts);
  console.log(`merchant agents: ${Object.keys(PERSONAS).filter(id => store.ready(id)).length} ready, decisions by ${LLM_KEY ? `${LLM_MODEL} (with rule checks)` : 'strategy rules (set NEARAI_API_KEY for LLM agents)'}`);
  const loop = () => tick().catch(e => console.error('agent tick', e instanceof Error ? e.message : e));
  setTimeout(loop, 5_000);
  setInterval(loop, TICK_MS).unref();
}
