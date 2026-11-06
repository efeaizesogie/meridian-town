# Play, earn, own: Meridian's economy

Meridian is built so that what a player earns is theirs, and so that the earning has a real
source rather than an endless printer. This page explains both: how a player earns, where that
money comes from, and what stops it from collapsing. The rules themselves are in
[RULES.md](RULES.md); the numbers below come from the contract's parameters and the simulator.

Today the game runs a testnet season, where MERI has no cash value. Everything here is how it
works on NEAR mainnet, where MERI (NEP-141) and shop deeds (NEP-171) are ordinary tradable tokens.

## 1. Ownership first

A player's account belongs to the player, not to the game.

- At sign-up the browser makes **12 recovery words**. Their public key is added to the new
  account as a full-access key; the server never sees the words.
- The game also gets a **play key** that can only call the town contract, so playing needs no
  wallet pop-ups and the game pays the gas.
- The same 12 words import into any NEAR wallet (standard BIP-39, path `m/44'/397'/0'`), so a
  player can move coins, goods and deeds out, or sell them, without asking us.
- **Log out and back in** on any device: the words sign one transaction that adds a fresh play
  key for the new browser. Coins, goods and deeds were on chain all along; XP and quests are
  keyed to the account and follow it.

## 2. How a player earns

| Source | How it works | In the game today |
| --- | --- | --- |
| **Labour** | Gather wood, ore and wheat; sell to whichever shop pays most. Shops pay more for what they lack. | yes |
| **Contracts** | A short shop posts a delivery job with its pay held in escrow, at a 15% premium. Deliver, get paid. | yes |
| **Trading** | Buy where something is plentiful, sell where it is short. The 20% spread means only real price gaps pay. | yes |
| **Shop ownership** | A shop that runs out of money goes to auction. The deed holder receives 50% of the shop's daily profit as dividends. | yes |
| **Deed sales** | Deeds are NEP-171 tokens with live data (cash, stock, lifetime dividends), sellable on any NEAR NFT marketplace. | contract yes; marketplace on mainnet |
| **The Festival** | Hit the weekly trade target and 1% of supply is minted to the players who traded, in proportion to their trade (counting up to 500 MERI each). | yes |
| **Guilds** | Pool coin in a Sputnik DAO, buy shops together, vote, and share out. | contract yes; guilds chartered on demand |
| **Caravan supply** | Anyone can enter the sealed-bid supply rounds and earn the margin on what shops order. | contract yes; player screen next |
| **Running a shopkeeper** | A deed holder appoints the shop's agent. Bring your own AI merchant and keep its profit. | contract yes; entry flow next |

In the simulator (60 days, 30 players, a mix of grinders, contract hunters and traders), an
honest player earned **20 to 55 MERI per day**, depending on how crowded the town was.

The in-game **ledger** (the coin purse in the HUD) shows each player what they have earned from
each source and what they own right now, valued at what the shops would pay, and in NEAR at the
MERI/wNEAR pool on Rhea. Its **Cash out** button swaps MERI into that pool and unwraps the result
to NEAR in the player's own account (signed with their recovery words), so earnings can leave
the game in one step.

**Townsfolk.** Three residents the game runs (Ivy, Rowan and Tamsin) gather, sell, take contracts,
carry raw goods from a glutted shop to a short one when the gap beats the tax, and buy bread and
tools a few at a time that they eat and wear out. They are ordinary accounts playing by the same
rules and prices, shown in the game as *Around town*. Their consumption is what keeps the bakery and
the forge short of stock, so the merchants buy, post contracts and move prices even when few
players are online. They share in Festivals like any trader.

## 3. Where the money comes from

A play-to-earn game that pays players only with newly minted coin collapses when new players
stop arriving. Meridian's income has real sources and real sinks.

**Money in**
- **Trade tax:** 2% of every player-to-shop trade goes to the town treasury.
- **Shop upkeep:** every shop pays 25 MERI a day; a shop that can't pay twice closes and goes to auction.
- **Auctions:** winning bids for deeds go to the treasury.
- **Planned for mainnet:** cosmetic and cottage styles sold for NEAR, sponsored seasons,
  and entry fees for the agent arena (developers pay to run their own merchants in a live market).

**Money out, which supports the coin's value**
- **The burn:** a missed Festival burns 5% of the treasury.
- **Bread and tools are consumed:** eating and building destroy goods, so shops keep buying.
- **Residents recycle the treasury:** each market day the town's households buy the bread and
  tools sitting above a shop's target, paid from the treasury (at most 1% of it a day, at most 40
  of each), and use them up. Tax and upkeep flow back into the shops, so the bakery and the forge
  keep producing, their wheat, wood and ore run down, and they post contracts and raise their bids.
  Residents never buy below target, and their trade doesn't count toward the Festival.
- **The spread:** a buy-and-sell round trip costs about 22%, so churning coin through shops loses money.

New coin appears only at a Festival, and only when the town as a whole traded more than its
target. Supply in the simulator stayed within about ±8% over 60 days, and every run checks that
all balances add up to the total supply exactly.

## 4. What stops abuse

- **Bots and sybils:** stamina limits how much one account can gather, each player's Festival
  share counts at most 500 MERI of trade, and wash trading pays the spread and the tax. In the
  simulator, 10 sybil accounts wash-trading together **lost 3,546 MERI**.
- **Agents can't cheat:** every merchant is a NEAR account with a key limited to town methods,
  and the contract rejects any move outside its limits (it logs them as refused).
- **The game can't take your account:** only the recovery words hold full access.

## 5. Before mainnet

- Liquidity for MERI on a NEAR exchange, so earnings have a market price.
- Verified-human checks for seasonal prize pools, so rewards go to people rather than farms.
- Legal review: a token that pays out for play can raise securities, gambling and tax questions
  depending on the country.
- The open items in [RULES.md §10](RULES.md): resident demand and the import balance.

None of this is a promise of income. Earnings depend on how many people play and what MERI and
deeds are worth to them; the design's job is to make sure that value comes from real activity.
