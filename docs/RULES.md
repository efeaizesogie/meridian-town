# Meridian Town — economy rules

The rules every participant plays by: players, merchant agents, supplier agents and the
town itself. Numbers come from [`packages/economy/src/params.ts`](../packages/economy/src/params.ts);
the contracts take the same values at launch and nobody can change them afterwards.
Merchant agents choose *strategy* within these rules (§9); they can't change the rules.

Run `node sim/run.ts` to see 60 days of the town under five scenarios (§10).

## 1. Money and items

- **MERI** (NEP-141) is the only currency. Genesis supply is 59,000: town treasury
  20,000, six shops × 1,500, outside traders 30,000. New coin only appears at a Festival
  (§7); coin only disappears in a missed-Festival burn.
- **Items** (one NEP-245 contract): wood, ore, wheat (raw), bread, tool (made in town).

| Item | Reference price | Where it comes from | What uses it up |
| --- | --- | --- | --- |
| wood | 4 | the Forest | tools (1 each) |
| ore | 6 | the Mine | tools (1 each) |
| wheat | 3 | the Fields | bread (1 each) |
| bread | 8 | Oswin's Bakery | +25 stamina; residents eat 1/day; home upgrades |
| tool | 24 | Hilde's Forge | doubles gathering yield for 25 swings; residents; home upgrades |

## 2. Prices

Every shop quotes from one formula, using only its own stock `S`, its target stock `T`
and the item's reference price `B`:

```
multiplier = (2T / (S + T))²         4x when empty, 1x at target, 0.25x at 3x target
ask        = B × multiplier(S)
bid        = B × multiplier(S + 1) × 0.8 × cash factor
cash factor = clamp(shop cash / 600, 0.25, 1)
```

- A shop never buys above 3× target, and never bids more than the cash it holds.
- A cash-poor shop pays less: below 600 MERI its bids shrink in proportion.
- **Trade tax:** 2% of every player↔shop trade goes to the town treasury.
- The 20% spread is also the main anti-cheat: a buy-and-sell round trip costs about 22%
  of what it adds to a player's counted volume (§7).

## 3. Shops, deeds and bankruptcy

- Each shop is an account (`<shop>.<town>`) holding its cash and stock, and an NEP-171
  **deed** (token id = shop id). The town holds all six deeds at genesis.
- **The deed holder controls the shop.** They appoint its agent (§9) and collect its
  dividends. When a deed changes hands, by transfer or at auction, the old agent is
  removed. Only the new holder can appoint one. The operator can't touch a player's shop.
- **Upkeep:** 25 MERI per day to the treasury. Two missed days in a row → the shop closes,
  **the holder forfeits the deed** to the town, and a bankruptcy auction opens.
- **Auctions** run for one market day. Bids start at the 300 MERI reserve, and each new
  bid must beat the last by 5%. Bids are held by `auction.<town>`; an outbid bidder is
  refunded at once.
  - *Bankruptcy auction:* the winning bid goes **into the shop's till**, which reopens it.
    If nobody bids within 3 days, the treasury recapitalises the shop with 600 and keeps
    the deed.
  - *Town sale:* the operator can auction a deed the town holds while the shop keeps
    trading. The winning bid goes to the treasury.
- **Dividends:** at the end of each day, a shop that made a profit and holds more than 600
  MERI pays its deed holder the larger of half that day's profit or everything above
  2,000. Town-held deeds pay the treasury.
- **Deeds are live.** `nft_token` returns the shop's current till, stock, status, agent
  and lifetime dividends, plus a deed card image drawn from that data, so a wallet shows
  the shop as it is now.

## 4. Gathering

- Three grounds regrow a fixed amount per day: **Forest 45 wood, Mine 45 ore, Fields
  115 wheat**, holding at most one day's regrowth. Every player draws from the same pool.
- A swing costs 5 stamina and takes 1 unit (2 with a tool) if the ground has any left.
  Stamina: 100 max, +30 per day, +25 per bread.
- **Total raw supply doesn't grow with the number of players.** More players means each
  one gets less, and an empty ground pushes people to the quiet one. That is the
  30-second decision in the game.
- **Home upgrades:** each day a player can put savings above 150 MERI into their cottage,
  buying tools and bread from shops. This is the main way player earnings flow back into
  the shops.

## 5. Delivery contracts (Proof-to-Pay)

- When a shop's raw stock falls below 30% of target, it posts a contract for enough units
  to reach 60%, at its current bid +15%, for 6 hours.
- The full payment is **locked in escrow when the contract is posted**. Each unit
  delivered into the shop's inventory releases its share automatically. Unfilled
  escrow returns to the shop at the deadline.
- Neither side decides the work is done: the item transfer is the proof.

## 6. The caravan

An open, sealed-bid import market, run by the contract every market day:

1. **Orders.** At the end of each day, every open shop holding less than half its target of
   a raw good it buys orders enough to reach target. The most it will pay is its own ask at
   that stock.
2. **Sealed bids (first half of the next day).** Any account can commit one sealed bid per
   good: the sha256 of `"<day>:<item>:<price>:<salt>:<supplier>"`. Only the number of sealed
   bids is visible.
3. **Reveals (second half).** Suppliers reveal price and salt; the contract checks them
   against the seal. Bids below the import cost (1.1× reference) are refused.
4. **Settlement (end of day).** The lowest revealed price per good fills every order it's
   within, up to what each shop still needs and half its cash. The shop pays the price; the
   supplier keeps price minus the import cost, which goes to the outside traders.

So the caravan caps raw prices from above, and competition between suppliers pulls them
toward cost. The game runs three supplier agents with different temperaments, and anyone
else can join: the contract doesn't know who runs a supplier.

Exports aren't on chain yet; the simulator still models them.

## 7. The Festival (memecoin mechanic)

At the end of each 7-day market week:

```
counted volume = Σ over players of min(player's shop trades this week, 500)
                 (players under 20 MERI don't count)
hit            = counted volume ≥ target
```

- **Hit:** mint 1% of total supply, split between players in proportion to their counted
  volume. The streak goes up.
- **Miss:** burn 5% of the town treasury. The streak resets.
- **Next target** = max(1,000, 0.95 × average counted volume of the last two weeks).

So the town has to keep at least 95% of its recent trading pace. A stable or growing town
celebrates; a shrinking one burns its treasury. The burn lowers resident demand, which
makes the next week harder. All parameters are fixed at launch, and there's no admin key.

**What stops cheating, and where that stops working.** Each player's counted volume is
capped at 500, and wash trading pays the spread. In the simulation, 10 fake accounts with
1,000 MERI each lost **3,546 MERI** over 53 days while the honest players collected the
Festival mints. Wash trading is a way to pay for someone else's party. It isn't stopped
outright: someone willing to lose money can still keep a streak alive. Sign-up limits
(one account per email, plus the 500 cap) are our defence for the demo, not a proof.

## 8. Guilds

Guilds are Sputnik DAOs (`sputnikv2.testnet`) that the town charters and registers. Players
join by proposal; the game's registrar approves players asking to join as themselves.
Members pay MERI into the treasury (`pay_guild`) and vote, by simple majority, on proposals
that the DAO executes against the town: bid for a deed (the guild then holds the shop and
receives its dividends), share MERI out to members (`share_out`), or appoint a shop's agent.
Proposals carry no bond, so players' limited keys can propose and vote.

## 9. What agents decide

| Merchant agents decide | Fixed by the contracts |
| --- | --- |
| Target stock, within ±30% of genesis | Price formula (§2) |
| When to post a contract, and quantity up to the §5 cap | Escrow and release |
| Whether to join the caravan order | Upkeep, closure, auction, dividends |
| Dialogue, and the reasoning shown in the price tooltip | Festival mint and burn |

Supplier agents choose their sealed bids. Players do whatever they like.

## 10. Simulation results (60 days, seed 7)

`node sim/run.ts`. Scenarios run with a mix of grinders, contract hunters and arbitrageurs.

| Scenario | Supply | Festivals | Shop closures | MERI per player-day |
| --- | --- | --- | --- | --- |
| steady — 30 players | −1.0% | 4/8 | 4 | 30.5 |
| boom — 10 → 100 players | +8.3% | 8/8 | 0 | 20.6 |
| churn — 30, then 8 from day 20 | −1.0% | 4/8 (misses after the drop, then recovers) | 4 | 54.9 |
| ghost — 5 players | +8.3% | 8/8 | 3 | 150.8 |
| wash — steady + 10 sybils | +8.3% | 8/8 | 2 | 32.1 (sybils: −3,546) |

Every run checks that all balances add up to supply exactly.

### Still open

- **Residents are underfunded.** About half their daily bread demand goes unmet because
  the stipend (2% of treasury per day) shrinks as the treasury drifts from ~18k to ~10k.
  Next to try: a higher stipend paired with upkeep that scales with shop revenue.
- **Raw goods are imported far more than exported** (about 2,300 vs 300 units in steady),
  so coin steadily leaks to outside traders. Ground regrowth should go up a little, or
  import markup down.
- **A small, steady town hits every Festival.** That's working as designed (beat 95% of
  your own pace), but it may be too easy for the demo. Consider a 1.0 growth factor once
  the stipend is fixed.
