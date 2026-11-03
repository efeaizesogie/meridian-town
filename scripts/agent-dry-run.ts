// Ask every merchant what it would do right now, without sending anything.
//   node --env-file-if-exists=.env scripts/agent-dry-run.ts        (game server running on :8787)
//   AGENT_LLM_MODEL=<model> ...  to try another NEAR AI Cloud model
process.env.AGENTS = 'off';
const { decideByLLM, decideByRules } = await import('../apps/server/src/agents.ts');
const API = process.env.API ?? 'http://localhost:8787';
const w = await (await fetch(`${API}/api/world`)).json();

console.log(`model: ${process.env.AGENT_LLM_MODEL ?? 'default'}\n`);
let total = 0, ok = 0;
const usage = { tokens: 0 };
for (const s of w.shops) {
  const rules = decideByRules(s, w.jobs, w.params);
  const t0 = Date.now();
  const llm = await decideByLLM(s, w.jobs, w.params, w.town, rules, usage);
  const ms = Date.now() - t0;
  total += ms;
  if (llm) ok++;
  console.log(`${s.shop.id.padEnd(10)} ${String(ms).padStart(6)} ms  ${llm ? `“${llm.say}”` : 'FAILED (rules would be used)'}`);
  if (llm) console.log(`${''.padEnd(19)}${llm.actions.map(a => JSON.stringify(a)).join(' ') || 'no actions'}`);
  console.log(`${''.padEnd(19)}rules: ${rules.actions.map(a => JSON.stringify(a)).join(' ') || 'no actions'}`);
}
console.log(`\n${ok}/${w.shops.length} valid, avg ${Math.round(total / w.shops.length)} ms, ${usage.tokens} tokens for 6 decisions`);
