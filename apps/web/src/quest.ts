// The quest scroll's next step. The server says which quest is current; this reads the player's
// pack, purse and the shops to say exactly what to do next and where, so the scroll follows
// the player through the quest instead of repeating its opening line.
import type { World } from './App';
import type { Place } from './TownMap';
import { ITEMS, meri, type Item } from './types';

export interface Step {
  /** The instruction on the scroll, in the second person. */
  text: string;
  /** Where "Show me" goes. */
  place: Place;
  /** The button's words. */
  go: string;
}

const RAW: Item[] = ['wood', 'ore', 'wheat'];
const GROUND: Record<string, Place> = { wood: 'g:forest', ore: 'g:mine', wheat: 'g:fields' };
const GROUND_NAME: Record<string, string> = { wood: 'the Forest', ore: 'the Mine', wheat: 'the Fields' };
const plural = (n: number, item: string) => `${n} ${item}${n === 1 || item === 'wheat' || item === 'bread' || item === 'ore' ? '' : 's'}`;

function have(world: World, item: Item) {
  return world.player?.items[ITEMS.indexOf(item)] ?? 0;
}

/** The ground worth swinging at: the most left, weighted by what shops pay for it. */
function bestGround(world: World): Item {
  return RAW.map((item, i) => ({ item, v: world.town.grounds[i] * Math.max(0, ...world.shops.map(s => Number(s.bid[i]))) }))
    .sort((a, b) => b.v - a.v)[0].item;
}

/** The open shop paying most for something already in the pack. */
function bestSale(world: World) {
  return world.shops
    .filter(s => s.shop.open)
    .flatMap(s => RAW.map((item, i) => ({ s, item, n: have(world, item), price: meri(s.bid[i]) })).filter(x => x.n > 0 && x.price > 0))
    .sort((a, b) => b.price - a.price)[0];
}

/** The cheapest open shop selling `item`, with what it costs including the 2% trade tax. */
function cheapest(world: World, item: Item) {
  const i = ITEMS.indexOf(item);
  return world.shops
    .filter(s => s.shop.open && s.shop.sells.includes(item) && s.ask[i] !== '0')
    .map(s => ({ s, cost: meri(s.ask[i]) * 1.02 }))
    .sort((a, b) => a.cost - b.cost)[0];
}

/** What to do when the purse is short: sell what's in the pack, or gather something to sell. */
function raiseMoney(world: World, need: number, forWhat: string): Step {
  const sale = bestSale(world);
  if (sale) return { text: `You need about ${need.toFixed(2)} MERI for ${forWhat}. Sell your ${plural(sale.n, sale.item)} at ${sale.s.shop.name} first.`, place: `s:${sale.s.shop.id}`, go: 'Go and sell' };
  const g = bestGround(world);
  return { text: `You need about ${need.toFixed(2)} MERI for ${forWhat}. Gather some ${g} in ${GROUND_NAME[g]} to sell.`, place: GROUND[g], go: 'Go and gather' };
}

/** Buy one `item` where it's cheapest, or raise the money for it first. */
function buy(world: World, item: Item, then: string): Step {
  const c = cheapest(world, item);
  const coins = meri(world.player?.coins ?? 0);
  if (!c) return { text: `No shop has ${item} for sale right now. Check back after the next market day.`, place: item === 'tool' ? 's:smith' : 's:baker', go: 'Have a look' };
  if (coins < c.cost) return raiseMoney(world, c.cost, `a ${item === 'bread' ? 'loaf' : item}`);
  return { text: `Buy ${item === 'bread' ? 'a loaf' : `a ${item}`} at ${c.s.shop.name} for ${c.cost.toFixed(2)} MERI, ${then}.`, place: `s:${c.s.shop.id}`, go: `Buy ${item === 'bread' ? 'a loaf' : `a ${item}`}` };
}

export function nextStep(world: World): Step | null {
  const q = world.me?.current;
  if (!q) return null;
  switch (q.id) {
    case 'swing': {
      const g = bestGround(world);
      return { text: `Head to ${GROUND_NAME[g]} and swing for ${g}. Each swing costs a little stamina.`, place: GROUND[g], go: 'Take me there' };
    }
    case 'sell': {
      const sale = bestSale(world);
      if (sale) return { text: `Sell your ${plural(sale.n, sale.item)} at ${sale.s.shop.name}: it pays the most right now, ${sale.price.toFixed(2)} each.`, place: `s:${sale.s.shop.id}`, go: 'Go and sell' };
      const g = bestGround(world);
      return { text: `Your pack is empty. Gather some ${g} in ${GROUND_NAME[g]} first, then sell it.`, place: GROUND[g], go: 'Go and gather' };
    }
    case 'eat':
      if (have(world, 'bread') > 0) return { text: 'You have a loaf in your pack. Eat it at your cottage to get your stamina back.', place: 'cottage', go: 'Go and eat' };
      return buy(world, 'bread', 'then eat it at your cottage');
    case 'deliver': {
      const job = [...world.jobs].sort((a, b) => Number(b.unit_price) - Number(a.unit_price))[0];
      if (!job) return { text: 'No contracts are posted yet. A shop posts one when its stock runs low; check the Notice Board again soon.', place: 'board', go: 'See the board' };
      const shop = world.shops.find(s => s.shop.id === job.shop_id)?.shop.name ?? job.shop_id;
      if (have(world, job.item) > 0) return { text: `${shop} needs ${job.item}. Deliver yours on the Notice Board for ${meri(job.unit_price).toFixed(2)} each.`, place: 'board', go: 'Deliver' };
      return { text: `${shop} needs ${job.item} and pays ${meri(job.unit_price).toFixed(2)} each. Gather some in ${GROUND_NAME[job.item] ?? 'town'}, then deliver it on the Notice Board.`, place: GROUND[job.item] ?? 'board', go: 'Go and gather' };
    }
    case 'cottage': {
      const c = world.me?.cottage;
      const need = c?.next?.cost;
      if (!c || !need) return { text: 'Your cottage is as big as it gets.', place: 'cottage', go: 'Go home' };
      const toolsLeft = need.tool - c.tool;
      const breadLeft = need.bread - c.bread;
      if ((toolsLeft > 0 && have(world, 'tool') > 0) || (breadLeft > 0 && have(world, 'bread') > 0)) return { text: 'Take the tools and bread in your pack home and build them into your cottage.', place: 'cottage', go: 'Go home' };
      if (toolsLeft > 0) return buy(world, 'tool', `then take it home (${toolsLeft} more needed)`);
      if (breadLeft > 0) return buy(world, 'bread', `then take it home (${breadLeft} more needed)`);
      return { text: 'Everything is ready. Go home and raise your cottage.', place: 'cottage', go: 'Go home' };
    }
    case 'guild':
      return { text: 'Ask to join the Hammer or the Harvest Guild. The guild’s registrar lets you in within a minute.', place: 'guildhall', go: 'Visit the Guild Hall' };
    case 'deed':
      return { text: 'Bid for a shop’s deed at the Auction House, alone or through your guild.', place: 'auction', go: 'Visit the auctions' };
    default:
      return { text: q.hint, place: (q.place as Place) ?? 'board', go: 'Show me' };
  }
}
