# Meridian Town — the game

What turns Meridian from a market with buttons into a game: the fantasy, the loops, how a
player grows, how the first session goes, and how it should feel. Rules and numbers live in
[RULES.md](RULES.md); this is about the experience.

## The fantasy

**Arrive with nothing. Read the market. Own the town.**

You walk into Meridian with an empty pack. Six shopkeepers, each run by an AI with its own
purse and temper, buy and sell what the town needs. A caravan of outside traders bids for
the town's orders every day. Once a week the town either throws a Festival or watches its
treasury burn. You start by swinging a pick at the Mine; you end up owning shops, leading a
guild and deciding whether the town celebrates.

## Pillars

1. **The town lives without you.** Merchants think and act, caravans come and go, the clock
   runs, the Festival judges the week. You step into a world that's already moving.
2. **Prices are the gameplay.** Like Animal Crossing's turnip market or EVE's trade hubs,
   the fun is reading prices: the empty forge paying 4× for ore, the glutted granary paying
   pennies. Every price shows the rule behind it.
3. **What you own is real.** Coins, goods and shop deeds are tokens you hold. A shop's deed
   *is* the shop: its till, its stock, its dividends.
4. **Small swings, big stakes.** Thirty seconds of gathering earns pocket change; a well-timed
   deed bid or a guild vote can change who owns the town.

## The loops

| Every… | You… | Feedback |
| --- | --- | --- |
| 30 seconds | Swing at a ground, haul, sell to the best buyer | +ore floats up, coins chime, price signs dip as you sell |
| 5 minutes | Take a delivery contract, eat bread, use a tool, spot a price gap | Contract pays on the spot, stamina refills, tool doubles yield |
| Market day (15 min) | Watch the caravan's sealed bids, build up your cottage, finish quests | Caravan wagons roll in, cottage grows, quest chime |
| Market week (~1¾ h) | Push the town to its Festival target | Festival banner, MERI minted to traders, or the treasury burns |
| Over days | Win deeds, join a guild, vote, collect dividends | Your name on a shop sign, guild treasury, leaderboard |

## How a player grows

- **Title and level.** XP comes from honest work: gathering, selling, delivering, building,
  bidding, joining. Titles show it: Wanderer → Peddler → Hauler → Trader → Merchant →
  Burgher → Patron of Meridian.
- **The cottage.** Your home is the main thing you spend on. Each level burns tools and
  bread (bought from the shops, so it feeds the economy) and raises your stamina cap, so you
  can work longer between meals.
- **Ownership.** Deeds are the long game: win one at auction and the shop pays you every
  profitable day. Guilds let players pool coin for shops none could buy alone.
- **Standing.** The leaderboard ranks players by purse and by shops held.

## The first session

Teach one thing at a time, by doing it (research: players drop within the first two
minutes if nothing happens). A quest chain with a pulsing marker on the map:

1. **First swing.** Swing a pick at any ground.
2. **Find the best buyer.** Sell what you gathered. The hint: check every shop's sign.
3. **Fuel up.** Buy bread and eat it.
4. **Honest work.** Deliver to a contract on the notice board.
5. **A roof over your head.** Raise your cottage to level 2.
6. **Strength in numbers.** Join a guild.
7. **A stake in the town.** Bid for a shop's deed, alone or through your guild.

Each step gives XP and unlocks the next hint; finishing the chain earns the title *Trader*
and ends on the moment that matters most: your name in a bid for a piece of the town.

## How it looks

Meridian is a stylized low-poly island diorama, in the spirit of Townscaper and Islanders,
built in three.js and modelled in code (no downloaded assets):

- **The island lives on the market clock.** A low sun rises in front of the island and sets
  behind it; golden hour throws long shadows across the square; at night the windows and
  lanterns light up, stars come out and fireflies drift over the forest and fields.
- **Places show the game's state.** The forest thins as it's cut, the mine's glowing ore
  shrinks with its stock, the wheat grows back, contracts are pinned to the notice board,
  wagons wait at the caravan gate during a round, the Festival banner rises with the week's
  trading, and your cottage grows (and smokes) as you build it.
- **People.** Each shopkeeper stands outside their shop; townsfolk wander between places; you
  walk to wherever you click while the camera flies there.
- **Finish.** Soft shadows, ambient occlusion, bloom on lit windows and forge fires, filmic
  tone mapping and a vignette. A cinematic fly-in over the sea when you arrive.
- **Sound.** Synthesized, no audio files: a slow pentatonic melody, birdsong by day,
  crickets at night, and feedback sounds for actions. One mute button.
- **Accessible fallback.** 🗺️ switches to the illustrated 2D map (also used automatically if
  WebGL fails); phones get a lighter 3D mode.

## How it should feel

- **The map is the menu.** The main screen is the town: grounds to the north, the market
  square in the middle, the caravan road to the east, the guild hall and auction house to
  the west, your cottage to the south. Click a place to go there.
- **Feedback scales with importance.** A swing gets a small "+2 ore"; a sale gets coins
  flying to your purse and a chime; a level-up gets a banner; the Festival gets the whole
  square. Routine actions stay quiet. Sound can be muted, and motion respects the system's
  reduced-motion setting.
- **Merchants talk.** Shopkeepers' latest words appear over their shops, and their price
  signs show what they pay right now.
- **Day and night.** The map darkens as the market day ends.

## Research behind this

- Animal Crossing's stalk market: buy low, sell high, perishable stock, shared price-hunting.
- EVE Online: gathering → manufacturing → trade, regional price gaps, consumption as a sink.
- First-time user experience research: action in the first 90 seconds, incremental
  mechanics, end the first session on a moment of joy.
- "Juice it or lose it" (Jonasson & Purho) and The Art of Screenshake (Vlambeer): feedback
  that echoes the core action and scales with importance.
