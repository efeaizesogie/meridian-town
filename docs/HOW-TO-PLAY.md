# How to play Meridian Town

**Arrive with nothing. Read the market. Own the town.**

Meridian is a market town that runs itself. Six shops are kept by AI merchants with their
own purses. Outside traders bid every day to supply the town. Once a week the town either
throws a Festival or burns part of its treasury. You start with an empty pack.

## Getting in

Open the game, pick a name, and you're in. No wallet, no seed phrase: the game creates your
NEAR account (`<name>.game.efecode.testnet`) and a key that lives in your browser and can
only act in Meridian. The game pays your gas.

The quest scroll (top left) walks you through your first session, and its pulsing ring on
the map shows where to go. 📖 opens this guide in the game.

## The screen

- **The map is the menu.** Click a place to go there; what you can do there opens beside the map.
  - North: **the Forest** (wood), **the Mine** (ore), **the Fields** (wheat).
  - Middle: **the market square**, with six shops around the fountain. Each shop's sign shows its best price right now; 🔥 means it's paying 1.5× or more.
  - West: **the Guild Hall** and **the Auction House**.
  - East: **the Caravan Road**.
  - South: **your Cottage**, **the Notice Board**, **the Festival Stage**.
- **The top bar** shows your title, level and XP, the market clock (a day lasts 15 minutes), the Festival meter, your purse 🪙 and your stamina ⚡.
- **Shopkeepers talk.** Their speech bubbles are their AI deciding what to do, and every move they make is on the blockchain.

## Making money

1. **Gather.** Swing at a ground. Each swing of 4 costs 20 stamina and yields 1 per swing (2 with a tool). The grounds are shared and regrow through the day, so if everyone is at the Mine, the Forest is the better trip. Tap **Swing** once to heft your tool, then again as it slides over the gold notch on the plank: a perfect strike earns bonus XP (never extra goods).
1. **Follow the week's event.** Each market week has one event (the Harvest fair, an Early frost, the Rail survey) that raises demand for one good: the shopkeepers it touches raise their targets, so that good pays more all week. It's shown in the Festival panel and at the ground it affects.
2. **Sell to the best buyer.** Every shop prices with one rule: *the less it has, the more it pays.* A shop that has run out pays up to 4× the usual price; a full one pays pennies. Each unit you sell lowers the price a little, so split big loads across shops. Hover any price to see exactly how it was worked out.
3. **Take contracts.** When a merchant runs short, it posts a delivery contract on the Notice Board, with the money already locked in escrow. Deliver and you're paid on the spot, usually above market price.
4. **Mind the spread.** Shops sell for about 25% more than they buy. Buying in one shop and selling in another only pays when their prices drift far apart.

## Growing stronger

| | What it does | Where |
| --- | --- | --- |
| 🍞 Bread | +25 stamina | Bakery or General Store, then **Eat** from your pack at the Cottage |
| 🔨 Tool | Double yield for 25 swings | Forge or General Store, then **Use a tool** |
| 🏠 Cottage | Raises your stamina cap: 100 → 125 → 150 → 175 → 200 | Bring tools and bread home and **add** them |
| ⭐ XP | Earned by gathering, selling, delivering, building, bidding | Levels and titles: Wanderer → Peddler → Hauler → Trader → Merchant → Burgher → Patron of Meridian |

XP only counts for things that actually happened on the chain; the server checks each transaction.

**Marks of the trade.** Twelve marks, one for each part of town life (gather each good, a perfect swing, ten of them, sell to four different shops, eat, use a tool, fill a contract, build your cottage, bid for a deed, claim a Festival share). Each is worth XP, and the full set raises your stamina cap by 25 for good. See them, the **town records** and **where every coin sits** in the *Town books* (the scroll button, or More on a phone).

## Owning the town

- **A deed is a shop.** Whoever holds a shop's deed appoints the AI that runs it and collects
  its dividends: on each profitable day, half the profit or everything above 2,000 MERI,
  whichever is more. Deeds are NFTs; a wallet shows the shop's live till and stock.
- **Auctions.** A shop that misses its daily upkeep twice closes, and its owner loses the deed.
  It's auctioned for one market day; the winning bid goes into the till and reopens the shop.
  The town also sells deeds it holds. Bids start at 300 MERI and must beat the last by 5%; if
  you're outbid, you're refunded at once.
- **Guilds.** Guilds are DAOs. Join one at the Guild Hall, pay MERI into its treasury, and vote
  with the other members: bid for a shop together, share earnings out, or appoint a shop's AI.
  Majority rules, and the DAO carries out what wins.
- **The Festival.** Each market week (7 days, about 1¾ hours) the town has a trading target. Hit
  it and new MERI is minted to everyone who traded, in proportion to how much they traded (up
  to 500 MERI counted each); claim it at the Festival Stage. Miss it and 5% of the treasury
  burns, and the town gets poorer.
- **The caravan.** When shops run short, outside suppliers bid to restock them in a sealed-bid
  auction: sealed prices in the first half of the day, revealed in the second, cheapest wins.
  It stops shortages from lasting forever.

## Playing well

- **Go where others aren't.** A crowded ground runs dry; a quiet one is full.
- **Sell into shortages.** Look for 🔥 signs. An empty Forge can pay four times what the Mine Office pays for the same ore.
- **Beat the caravan.** When a caravan round is open (wagons on the road), shops are about to be restocked from outside and prices will fall. Sell before it lands.
- **Contracts first.** They pay above market and the money is already there.
- **Eat before you're empty.** A loaf costs a few MERI and buys five more swings.
- **Trade in Festival weeks.** Your share of the mint grows with what you trade.
- **Buy shops at the bottom.** A bankrupt shop's deed is cheapest when its shelves are bare, which is exactly when its prices, and so its takings, are highest.
- **Use ⏩ Fast-forward** to see how next week might go before you commit to a big bid.

## What's real

Everything of value is on the NEAR blockchain (testnet for now): MERI (NEP-141), goods
(NEP-245), deeds (NEP-171), and every trade, contract, bid and vote. Merchants and suppliers
are AI agents with their own accounts, whose keys can only do what the town's rules allow;
guilds are Sputnik DAOs. The rules are in [RULES.md](RULES.md); the design is in [GAME.md](GAME.md).
