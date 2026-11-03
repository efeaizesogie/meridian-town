import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMS, Town, askPrice, bidPrice, stockMultiplier, type Strategy } from '../src/index.ts';

const MIX: Strategy[] = ['grinder', 'jobber', 'arbitrageur'];

test('stock multiplier: 4x empty, 1x at target, 0.25x at 3x target', () => {
  assert.equal(stockMultiplier(0, 100), 4);
  assert.equal(stockMultiplier(100, 100), 1);
  assert.equal(stockMultiplier(300, 100), 0.25);
});

test('a shop never bids above its own ask', () => {
  for (const stock of [0, 10, 50, 100, 250]) {
    const ask = askPrice(6, stock, 100);
    const bid = bidPrice(6, stock, 100, 10_000, DEFAULT_PARAMS);
    assert.ok(bid < ask, `stock ${stock}: bid ${bid} >= ask ${ask}`);
  }
});

test('a shop stops buying at 3x target and when it cannot pay', () => {
  assert.equal(bidPrice(6, 300, 100, 10_000, DEFAULT_PARAMS), 0);
  assert.equal(bidPrice(6, 50, 100, 0.5, DEFAULT_PARAMS), 0);
});

test('every coin is accounted for after 30 days, with mints and burns', () => {
  for (const players of [3, 30, 80]) {
    const t = new Town(DEFAULT_PARAMS, 42);
    t.runDays(30, tw => tw.setActivePlayers(players, MIX));
    assert.ok(t.weeks.length === 4);
    const drift = Math.abs(t.coinsAccountedFor() - t.supply);
    assert.ok(drift < 1e-6 * t.supply, `${players} players: drift ${drift}`);
    for (const s of t.shops) assert.ok(s.cash >= -1e-9, `${s.id} cash ${s.cash}`);
    for (const p of t.players) assert.ok(p.cash >= -1e-9, `${p.id} cash ${p.cash}`);
  }
});

test('festival mints on a hit and burns treasury on a miss', () => {
  const t = new Town({ ...DEFAULT_PARAMS, targetFloor: 1e12 }, 1); // impossible target
  t.runDays(7, tw => tw.setActivePlayers(10, MIX));
  assert.equal(t.weeks[0].hit, false);
  assert.ok(t.burned > 0 && t.minted === 0);

  const u = new Town({ ...DEFAULT_PARAMS, targetFloor: 1 }, 1); // trivial target
  u.runDays(7, tw => tw.setActivePlayers(10, MIX));
  assert.equal(u.weeks[0].hit, true);
  assert.ok(u.minted > 0 && u.burned === 0);
});

test('same seed, same town', () => {
  const run = () => {
    const t = new Town(DEFAULT_PARAMS, 9);
    t.runDays(14, tw => tw.setActivePlayers(20, MIX));
    return JSON.stringify(t.days.at(-1));
  };
  assert.equal(run(), run());
});

test('a town seeded from live state keeps its books and logs what happens', () => {
  const t = Town.fromLive(DEFAULT_PARAMS, {
    treasury: 18_000,
    grounds: [10, 45, 115],
    weekTarget: 1_000,
    shops: [
      { id: 'smith', cash: 900, stock: [0, 0, 0, 0, 50], target: [33, 33, 0, 0, 18], open: true, owner: 'efecode.testnet' },
      { id: 'store', cash: 20, stock: [0, 0, 0, 40, 10], target: [0, 0, 0, 40, 10], open: true, owner: 'town' },
    ],
  }, 3);
  assert.equal(t.shops.find(s => s.id === 'smith')!.stock.tool, 50);
  assert.equal(t.ground.wood, 10);
  t.runDays(7, tw => tw.setActivePlayers(30, MIX));
  assert.ok(Math.abs(t.coinsAccountedFor() - t.supply) < 1e-6 * t.supply);
  assert.ok(t.events.some(e => e.kind === 'contract'), 'the empty forge posts a contract');
  assert.ok(t.events.some(e => e.kind === 'closed'), 'the broke store closes');
  assert.equal(t.events.filter(e => e.kind === 'festival').length, 1);
});
