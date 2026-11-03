# Meridian Town — game design

A market town at a crossroads. Six shops, three gathering grounds, a guild hall and a
notice board. Every shopkeeper is an AI agent with its own NEAR account, cash and stock.
Every shop is owned through a deed that *is* that account. The town coin has one rule
baked into its contract: the town either grows every week or part of its treasury burns.

Players never see a wallet. They sign in with email, gather, trade and eat bread.

## The loop

### Every 30 seconds — gather and sell

1. Pick a ground: **Forest** (wood), **Mine** (ore), **Fields** (wheat).
2. Gather. Each swing costs stamina. A tool doubles the yield and wears down.
3. Walk to the square. Every shop shows a live buy price; it drops as the shop fills up.
4. Sell to the best price. You watch the price move because of you.

The decision every 30 seconds: *which ground is paying today, and who's buying?* If
everyone floods the Mine, ore gets cheap and the Forest is suddenly the better trip.

### Every 5 minutes — contracts, tools and food

- **Notice board.** A shop that is running low posts a delivery contract: *"Hilde needs
  12 ore by dusk, 7.5 each, paid on delivery."* The money is locked when the contract is
  posted and released by the contract the moment the ore lands in her stock — nobody
  decides by hand that the work is done. Miss the deadline and the money goes back.
- **Bread restores stamina; tools double the yield.** Both are made in town from what
  players gathered, so players are customers of their own supply chain.
- **Arbitrage.** The Lumberyard and the Blacksmith both buy wood. Their prices drift
  apart. Spot it, carry wood across the square, pocket the difference.

### Every session — own a piece of the town

- **Deeds.** A shop that can't pay its upkeep closes. Its deed goes to auction, and the
  winning bid goes straight into the till to reopen it. The deed holder then collects
  half of every profitable day. Sell the deed and the till, the stock and the dividends
  all move with it, because the deed is the shop's account.
- **Guilds.** Pool coin with friends in a guild (a Sputnik DAO). Buy deeds together,
  fund rescue contracts, vote on what to back next. Small spends pass automatically;
  big ones go to a vote.
- **The Festival.** Each market week the town has a trade target, shown as a mood meter
  over the square. Hit it and the Festival mints new coin to everyone who traded. Miss
  it and a slice of the town treasury burns — fewer coins for residents, less demand,
  harder next week. The longest streak of Festivals is written on the town gate.

## What the agents decide, and what they can't

| Merchants decide (LLM + strategy) | The contracts enforce (fixed rules) |
| --- | --- |
| Target stock level, within a band | The price formula — `RULES.md` §2 |
| When to post a delivery contract and how many units | Escrow and release on delivery |
| Whether to join the caravan order | Upkeep, bankruptcy and auction |
| What to say to you, and why the price is what it is | Dividend split to the deed holder |

A merchant can be clever about *strategy*. It can't pay itself, change the price rule or
move money it doesn't hold. The tooltip on every price shows the merchant's reasoning
next to the formula that actually produced the number.

## The caravan (swarm)

Once a day, merchants that are low on raw goods pool their orders into one caravan and
run a sealed-bid round against supplier agents from outside town. The cheapest supplier
wins; each merchant pays its share. Caravan goods cost more than what players sell for,
so the caravan is a **price ceiling**: it stops a shortage from becoming a spiral, and it
tells players exactly when they're being undercut.

## Fast-forward

A judge can press **Fast-forward a week** and watch seven market days run in a minute:
prices, stock, bankruptcies, caravans, the mood meter and the Festival result, driven
by the same rule code the live town uses (`packages/economy`).

## What's on chain

| Thing | Standard | Notes |
| --- | --- | --- |
| Items: wood, ore, wheat, bread, tool | NEP-245 multi-token | one contract holds every item type |
| Town coin (MERI) | NEP-141 | Festival mint/burn in the contract, no admin key |
| Shop deeds | NEP-171 | each token is tied to `shop-<name>.<town>` sub-account |
| Market | own contract | price formula, upkeep, bankruptcy, delivery escrow |
| Guilds | Sputnik DAO v2 | created from the existing factory |
| Caravan rounds | coordinator contract | commit/reveal bids from supplier agents |

Gathering and stamina live on the game server (no transaction per swing); items are
minted to the player in batches. Every trade with a shop is a transaction, paid for by
the game's relayer so the player never sees gas.
