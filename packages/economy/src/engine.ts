import { ITEMS, RAW, type Item, type Params } from './params.ts';
import { askPrice, bidPrice } from './pricing.ts';
import { makeRng, type Rng } from './rng.ts';

export type Strategy = 'grinder' | 'jobber' | 'arbitrageur' | 'washer';
export type Stock = Record<Item, number>;

export interface Shop {
  id: string;
  name: string;
  buys: Item[];
  sells: Item[];
  target: Partial<Record<Item, number>>;
  cash: number;
  stock: Stock;
  open: boolean;
  missedUpkeep: number;
  closedDays: number;
  owner: string; // 'town' or a player id
  cashAtDayStart: number;
  produced: number; // fractional production carried between ticks
}

export interface Player {
  id: string;
  strategy: Strategy;
  cash: number;
  inv: Stock;
  stamina: number;
  toolUses: number;
  weekVolume: number;
  active: boolean;
  earned: number; // gross MERI from selling + jobs + mints + dividends
  spent: number;
}

export interface Job {
  id: number;
  shopId: string;
  item: Item;
  qty: number;
  unitPrice: number;
  escrow: number;
  deadline: number;
}

export interface WeekResult {
  week: number;
  target: number;
  volume: number;
  hit: boolean;
  minted: number;
  burned: number;
  streak: number;
}

export interface DayStats {
  day: number;
  players: number;
  supply: number;
  treasury: number;
  shopCash: number;
  playerCash: number;
  outsideCash: number;
  residentsCash: number;
  escrow: number;
  openShops: number;
  ask: Stock;
  bestBid: Stock;
  imported: number;
  exported: number;
  unmetBread: number;
  jobsPosted: number;
  jobsFilled: number;
  shopTrades: number;
}

const emptyStock = (): Stock => ({ wood: 0, ore: 0, wheat: 0, bread: 0, tool: 0 });

function genesisShops(p: Params): Shop[] {
  const mk = (id: string, name: string, buys: Item[], sells: Item[], target: Partial<Record<Item, number>>): Shop => {
    const stock = emptyStock();
    for (const [k, v] of Object.entries(target)) stock[k as Item] = v!;
    return {
      id, name, buys, sells, target, stock,
      cash: p.genesisShopCash, open: true, missedUpkeep: 0, closedDays: 0,
      owner: 'town', cashAtDayStart: p.genesisShopCash, produced: 0,
    };
  };
  return [
    mk('lumberyard', 'Brann’s Lumberyard', ['wood'], ['wood'], { wood: 120 }),
    mk('mine', 'Petra’s Mine Office', ['ore'], ['ore'], { ore: 100 }),
    mk('granary', 'Wen’s Granary', ['wheat'], ['wheat'], { wheat: 150 }),
    mk('smith', 'Hilde’s Forge', ['wood', 'ore'], ['tool'], { wood: 30, ore: 30, tool: 20 }),
    mk('baker', 'Oswin’s Bakery', ['wheat'], ['bread'], { wheat: 60, bread: 60 }),
    mk('store', 'Mabel’s General Store', ['bread', 'tool'], ['bread', 'tool'], { bread: 40, tool: 10 }),
  ];
}

export class Town {
  p: Params;
  rng: Rng;
  tick = 0;
  shops: Shop[];
  players: Player[] = [];
  jobs: Job[] = [];
  treasury: number;
  residentsCash = 0;
  outsideCash: number;
  minted = 0;
  burned = 0;
  genesisSupply: number;
  weekTarget: number;
  weekVolumes: number[] = [];
  streak = 0;
  bestStreak = 0;
  weeks: WeekResult[] = [];
  days: DayStats[] = [];
  private nextJobId = 1;
  exportPrice: Partial<Record<Item, number>> = {};
  ground: Partial<Record<Item, number>> = {};

  constructor(p: Params, seed = 1) {
    this.p = p;
    this.rng = makeRng(seed);
    this.shops = genesisShops(p);
    this.treasury = p.genesisTreasury;
    this.outsideCash = p.outsideStartCoins;
    this.genesisSupply = p.genesisTreasury + p.outsideStartCoins + p.genesisShopCash * this.shops.length;
    this.weekTarget = p.targetFloor;
    for (const item of RAW) this.ground[item] = p.groundRegenPerDay[item] * p.groundCapacityDays;
  }

  get day() { return Math.floor(this.tick / this.p.ticksPerDay); }
  get supply() { return this.genesisSupply + this.minted - this.burned; }

  /** Sum of every coin balance. Must equal `supply` at all times. */
  coinsAccountedFor(): number {
    return this.treasury + this.residentsCash + this.outsideCash
      + this.shops.reduce((s, x) => s + x.cash, 0)
      + this.players.reduce((s, x) => s + x.cash, 0)
      + this.jobs.reduce((s, j) => s + j.escrow, 0);
  }

  // ---------- players ----------

  addPlayer(strategy: Strategy): Player {
    const starter = Math.min(this.p.starterCoins, this.treasury);
    this.treasury -= starter;
    const pl: Player = {
      id: `p${this.players.length + 1}`, strategy, cash: starter, inv: emptyStock(),
      stamina: this.p.maxStamina, toolUses: 0, weekVolume: 0, active: true, earned: 0, spent: 0,
    };
    this.players.push(pl);
    return pl;
  }

  setActivePlayers(target: number, mix: Strategy[]) {
    const active = this.players.filter(x => x.active && x.strategy !== 'washer');
    for (let i = active.length; i < target; i++) {
      const dormant = this.players.find(x => !x.active && x.strategy !== 'washer');
      if (dormant) dormant.active = true;
      else this.addPlayer(mix[i % mix.length]);
    }
    for (let i = active.length; i > target; i--) active[i - 1].active = false;
  }

  // ---------- prices ----------

  ask(shop: Shop, item: Item) {
    return askPrice(this.p.base[item], shop.stock[item], shop.target[item]!);
  }
  bid(shop: Shop, item: Item) {
    return bidPrice(this.p.base[item], shop.stock[item], shop.target[item]!, shop.cash, this.p);
  }
  cheapestSeller(item: Item, exclude?: Shop) {
    let best: Shop | undefined, price = Infinity;
    for (const s of this.shops) {
      if (!s.open || s === exclude || !s.sells.includes(item) || s.stock[item] < 1) continue;
      const a = this.ask(s, item);
      if (a < price) { price = a; best = s; }
    }
    return best ? { shop: best, price } : undefined;
  }
  bestBuyer(item: Item, exclude?: Shop) {
    let best: Shop | undefined, price = 0;
    for (const s of this.shops) {
      if (!s.open || s === exclude || !s.buys.includes(item)) continue;
      const b = this.bid(s, item);
      if (b > price) { price = b; best = s; }
    }
    return best ? { shop: best, price } : undefined;
  }

  // ---------- trades (RULES.md §2) ----------

  private playerSells(pl: Player, item: Item, minPrice = 0): boolean {
    const b = this.bestBuyer(item);
    if (!b || b.price < minPrice || pl.inv[item] < 1) return false;
    const tax = b.price * this.p.tradeTax;
    b.shop.cash -= b.price;
    b.shop.stock[item] += 1;
    pl.inv[item] -= 1;
    pl.cash += b.price - tax;
    this.treasury += tax;
    pl.weekVolume += b.price;
    pl.earned += b.price - tax;
    this.today.shopTrades++;
    return true;
  }

  private playerBuys(pl: Player, item: Item, maxPrice = Infinity): boolean {
    const s = this.cheapestSeller(item);
    if (!s || s.price > maxPrice) return false;
    const cost = s.price * (1 + this.p.tradeTax);
    if (pl.cash < cost) return false;
    pl.cash -= cost;
    pl.spent += cost;
    s.shop.cash += s.price;
    s.shop.stock[item] -= 1;
    this.treasury += cost - s.price;
    pl.inv[item] += 1;
    pl.weekVolume += s.price;
    this.today.shopTrades++;
    return true;
  }

  /** Shops restock from each other when another shop sells below what they'd pay. */
  private shopToShop() {
    for (const buyer of this.shops) {
      if (!buyer.open) continue;
      for (const item of buyer.buys) {
        for (let n = 0; n < 10; n++) {
          const s = this.cheapestSeller(item, buyer);
          if (!s || buyer.stock[item] >= buyer.target[item]!) break;
          const willing = this.bid(buyer, item);
          if (s.price > willing || buyer.cash < s.price) break;
          buyer.cash -= s.price;
          buyer.stock[item] += 1;
          s.shop.cash += s.price;
          s.shop.stock[item] -= 1;
        }
      }
    }
  }

  // ---------- production & residents ----------

  private produce() {
    const t = this.p.ticksPerDay;
    const smith = this.shops.find(s => s.id === 'smith')!;
    const baker = this.shops.find(s => s.id === 'baker')!;
    const run = (s: Shop, cap: number, inputs: Item[], out: Item) => {
      if (!s.open) return;
      s.produced += cap / t;
      while (s.produced >= 1) {
        s.produced -= 1;
        if (s.stock[out] >= s.target[out]! * this.p.maxStockMult) break;
        if (inputs.some(i => s.stock[i] < 1)) break;
        for (const i of inputs) s.stock[i] -= 1;
        s.stock[out] += 1;
      }
    };
    run(smith, this.p.blacksmithCapacity, ['wood', 'ore'], 'tool');
    run(baker, this.p.bakerCapacity, ['wheat'], 'bread');
  }

  private residentsShop() {
    const t = this.p.ticksPerDay;
    const buy = (item: Item, qty: number) => {
      let left = qty;
      while (left > 0) {
        const s = this.cheapestSeller(item);
        if (!s || this.residentsCash < s.price) break;
        this.residentsCash -= s.price;
        s.shop.cash += s.price;
        s.shop.stock[item] -= 1;
        left--;
      }
      return left;
    };
    const breadNeed = this.stochasticRound(this.p.residents * this.p.residentBreadPerDay / t);
    const toolNeed = this.stochasticRound(this.p.residents / this.p.residentToolEveryDays / t);
    this.today.unmetBread += buy('bread', breadNeed);
    buy('tool', toolNeed);
  }

  private stochasticRound(x: number) {
    const f = Math.floor(x);
    return f + (this.rng.chance(x - f) ? 1 : 0);
  }

  // ---------- delivery contracts (RULES.md §5) ----------

  private postJobs() {
    for (const s of this.shops) {
      if (!s.open) continue;
      for (const item of s.buys) {
        if (!RAW.includes(item)) continue;
        const target = s.target[item]!;
        if (s.stock[item] >= target * this.p.jobTriggerStock) continue;
        if (this.jobs.some(j => j.shopId === s.id && j.item === item)) continue;
        const unitPrice = this.bid(s, item) * (1 + this.p.jobPremium);
        if (unitPrice <= 0) continue;
        const qty = Math.min(Math.ceil(target * 0.6 - s.stock[item]), Math.floor((s.cash * 0.5) / unitPrice));
        if (qty < 1) continue;
        const escrow = qty * unitPrice;
        s.cash -= escrow;
        this.jobs.push({ id: this.nextJobId++, shopId: s.id, item, qty, unitPrice, escrow, deadline: this.tick + this.p.jobHours });
        this.today.jobsPosted++;
      }
    }
  }

  private deliver(pl: Player, item: Item) {
    for (const j of this.jobs) {
      if (j.item !== item) continue;
      const shop = this.shops.find(s => s.id === j.shopId)!;
      const n = Math.min(j.qty, pl.inv[item]);
      if (n < 1) continue;
      const pay = n * j.unitPrice;
      j.qty -= n;
      j.escrow -= pay;
      pl.inv[item] -= n;
      shop.stock[item] += n;
      pl.cash += pay;
      pl.earned += pay;
      pl.weekVolume += pay;
      if (j.qty === 0) this.today.jobsFilled++;
    }
    this.jobs = this.jobs.filter(j => j.qty > 0);
  }

  private expireJobs() {
    for (const j of this.jobs) {
      if (j.deadline > this.tick) continue;
      this.shops.find(s => s.id === j.shopId)!.cash += j.escrow;
      j.escrow = 0;
      j.qty = 0;
    }
    this.jobs = this.jobs.filter(j => j.qty > 0);
  }

  // ---------- player behaviour ----------

  private bestGround(pl: Player): Item {
    if (pl.strategy === 'jobber') {
      const job = this.jobs.filter(j => RAW.includes(j.item)).sort((a, b) => b.unitPrice - a.unitPrice)[0];
      if (job) return job.item;
    }
    // Expected value of a swing: price x chance the ground still has something.
    let best: Item = 'wood', value = -1;
    for (const item of RAW) {
      const full = this.p.groundRegenPerDay[item] * this.p.groundCapacityDays;
      const v = (this.bestBuyer(item)?.price ?? 0) * Math.min(1, this.ground[item]! / (full * 0.25));
      if (v > value) { value = v; best = item; }
    }
    return best;
  }

  private act(pl: Player) {
    const p = this.p;
    if (pl.strategy === 'washer') return this.wash(pl);
    if (pl.strategy === 'arbitrageur') this.arbitrage(pl);

    const rawValue = Math.max(...RAW.map(i => this.bestBuyer(i)?.price ?? 0));
    const yieldPerSwing = pl.toolUses > 0 ? p.toolYield : 1;

    // Tool: worth it if the extra yield over its life beats the price.
    if (pl.toolUses === 0) {
      const t = this.cheapestSeller('tool');
      if (t && t.price * 1.5 < pl.cash && rawValue * p.toolDurability * (p.toolYield - 1) > t.price && this.playerBuys(pl, 'tool')) {
        pl.inv.tool -= 1;
        pl.toolUses = p.toolDurability;
      }
    }
    // Bread: eat when tired, if the swings it buys are worth more than it costs.
    const swingsWanted = p.swingsPerActiveTick;
    while (pl.stamina < swingsWanted * p.swingCost) {
      if (pl.inv.bread < 1) {
        const b = this.cheapestSeller('bread');
        const worth = (p.breadStamina / p.swingCost) * yieldPerSwing * rawValue;
        if (!b || b.price > worth || !this.playerBuys(pl, 'bread')) break;
      }
      pl.inv.bread -= 1;
      pl.stamina = Math.min(p.maxStamina, pl.stamina + p.breadStamina);
    }

    const ground = this.bestGround(pl);
    const swings = Math.min(swingsWanted, Math.floor(pl.stamina / p.swingCost));
    for (let i = 0; i < swings; i++) {
      pl.stamina -= p.swingCost;
      const want = pl.toolUses > 0 ? p.toolYield : 1;
      const got = Math.min(want, Math.floor(this.ground[ground]!));
      if (pl.toolUses > 0) pl.toolUses--;
      this.ground[ground]! -= got;
      pl.inv[ground] += got;
    }

    for (const item of RAW) {
      this.deliver(pl, item);
      while (pl.inv[item] > 0 && this.playerSells(pl, item, p.base[item] * 0.35)) { /* sell down */ }
    }
  }

  /** Spend savings on the cottage: alternating tools and bread, bought from shops and used up. */
  private upgradeHome(pl: Player) {
    let budget = (pl.cash - this.p.homeBuffer) * this.p.homeSpendRate;
    for (let n = 0; budget > 0 && n < 200; n++) {
      const item: Item = n % 3 === 0 ? 'tool' : 'bread';
      const before = pl.cash;
      if (!this.playerBuys(pl, item)) break;
      pl.inv[item] -= 1;
      budget -= before - pl.cash;
    }
  }

  private arbitrage(pl: Player) {
    for (const item of ITEMS) {
      for (let n = 0; n < 20; n++) {
        const s = this.cheapestSeller(item);
        const b = this.bestBuyer(item, s?.shop);
        if (!s || !b || b.shop === s.shop) break;
        if (b.price * (1 - this.p.tradeTax) <= s.price * (1 + this.p.tradeTax) * 1.02) break;
        if (!this.playerBuys(pl, item)) break;
        if (!this.playerSells(pl, item)) break;
      }
    }
  }

  /** Sybil attacker: churns volume up to the counted cap, paying the spread each round trip. */
  private wash(pl: Player) {
    const item: Item = 'wood';
    for (let n = 0; n < 50 && pl.weekVolume < this.p.playerVolumeCap; n++) {
      if (!this.playerBuys(pl, item)) break;
      if (!this.playerSells(pl, item)) break;
    }
  }

  // ---------- daily: caravan, upkeep, auctions, dividends ----------

  /** RULES.md §6. Sealed-bid round per item; suppliers are outside agents. */
  private caravan() {
    const p = this.p;
    for (const item of RAW) {
      // Imports: shops below half their target pool one order.
      const orders = this.shops
        .filter(s => s.open && s.buys.includes(item) && s.stock[item] < s.target[item]! * 0.5)
        .map(s => ({ s, qty: s.target[item]! - s.stock[item] }));
      if (orders.length) {
        const bids = Array.from({ length: p.suppliers }, () => p.base[item] * p.importMarkup * this.rng.range(1 - p.bidNoise, 1 + p.bidNoise));
        const price = Math.min(...bids);
        for (const { s, qty } of orders) {
          if (price > this.ask(s, item)) continue; // dearer than the shop values it
          const n = Math.min(qty, Math.floor((s.cash * 0.5) / price));
          if (n < 1) continue;
          s.cash -= n * price;
          s.stock[item] += n;
          this.outsideCash += n * price;
          this.today.imported += n;
        }
      }
      // Exports: outside buyers post today's standing bid; the best one holds all day.
      const appetite = Math.min(1, this.outsideCash / p.outsideStartCoins);
      this.exportPrice[item] = appetite * Math.max(...Array.from({ length: p.suppliers }, () => p.base[item] * p.exportDiscount * this.rng.range(1 - p.bidNoise, 1 + p.bidNoise)));
    }
  }

  /** Every tick, shops sell stock above `exportAbove` x target into the standing export bid. */
  private exportSurplus() {
    for (const item of RAW) {
      const price = this.exportPrice[item];
      if (!price) continue;
      for (const s of this.shops) {
        if (!s.open || !s.sells.includes(item)) continue;
        const surplus = Math.floor(s.stock[item] - s.target[item]! * this.p.exportAbove);
        const n = Math.min(surplus, Math.floor(this.outsideCash / price));
        if (n < 1) continue;
        s.stock[item] -= n;
        s.cash += n * price;
        this.outsideCash -= n * price;
        this.today.exported += n;
      }
    }
  }

  private endOfDay() {
    const p = this.p;
    for (const s of this.shops) {
      if (!s.open) continue;
      if (s.cash >= p.upkeep) { s.cash -= p.upkeep; this.treasury += p.upkeep; s.missedUpkeep = 0; }
      else if (++s.missedUpkeep >= p.missedUpkeepToClose) { s.open = false; s.closedDays = 0; }
    }
    // Auctions for closed shops (RULES.md §3).
    for (const s of this.shops) {
      if (s.open) continue;
      s.closedDays++;
      const bidders = this.players.filter(x => x.active && x.strategy !== 'washer' && x.cash > p.auctionReserve * 2);
      const top = bidders.sort((a, b) => b.cash - a.cash)[0];
      if (top) {
        const bid = Math.max(p.auctionReserve, top.cash * 0.5);
        top.cash -= bid;
        top.spent += bid;
        s.cash += bid;
        s.owner = top.id;
      } else if (s.closedDays >= p.auctionDaysBeforeTownRescue && this.treasury > p.auctionReserve * 2) {
        this.treasury -= p.auctionReserve * 2;
        s.cash += p.auctionReserve * 2;
        s.owner = 'town';
      } else continue;
      s.open = true;
      s.missedUpkeep = 0;
    }
    // Dividends.
    for (const s of this.shops) {
      const profit = s.cash - s.cashAtDayStart;
      if (s.open && profit > 0 && s.cash > p.cashComfort) {
        const div = Math.max(profit * p.dividendShare, s.cash - p.cashCeiling);
        s.cash -= div;
        const owner = this.players.find(x => x.id === s.owner);
        if (owner) { owner.cash += div; owner.earned += div; } else this.treasury += div;
      }
    }
    // Residents' stipend for tomorrow.
    const stipend = this.treasury * p.stipendRate;
    this.treasury -= stipend;
    this.residentsCash += stipend;
    // Home upgrades, then rest.
    for (const pl of this.players) {
      if (pl.active && pl.strategy !== 'washer') this.upgradeHome(pl);
      pl.stamina = Math.min(p.maxStamina, pl.stamina + p.staminaRegenPerDay);
    }
  }

  /** RULES.md §7. */
  private festival() {
    const p = this.p;
    const counted = this.players.map(x => (x.weekVolume >= p.minQualifyingVolume ? Math.min(x.weekVolume, p.playerVolumeCap) : 0));
    const volume = counted.reduce((a, b) => a + b, 0);
    const hit = volume >= this.weekTarget;
    let minted = 0, burned = 0;
    if (hit) {
      minted = this.supply * p.festivalMintRate;
      this.players.forEach((x, i) => {
        const share = (minted * counted[i]) / volume;
        x.cash += share;
        x.earned += share;
      });
      this.minted += minted;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    } else {
      burned = this.treasury * p.missBurnRate;
      this.treasury -= burned;
      this.burned += burned;
      this.streak = 0;
    }
    this.weeks.push({ week: this.weeks.length + 1, target: this.weekTarget, volume, hit, minted, burned, streak: this.streak });
    this.weekVolumes.push(volume);
    const recent = this.weekVolumes.slice(-2);
    this.weekTarget = Math.max(p.targetFloor, p.targetGrowth * (recent.reduce((a, b) => a + b, 0) / recent.length));
    for (const x of this.players) x.weekVolume = 0;
  }

  // ---------- main loop ----------

  private today: DayStats = this.blankDay(0);
  private blankDay(day: number): DayStats {
    return {
      day, players: 0, supply: 0, treasury: 0, shopCash: 0, playerCash: 0, outsideCash: 0, residentsCash: 0, escrow: 0,
      openShops: 0, ask: emptyStock(), bestBid: emptyStock(), imported: 0, exported: 0, unmetBread: 0,
      jobsPosted: 0, jobsFilled: 0, shopTrades: 0,
    };
  }

  step() {
    const p = this.p;
    const tickOfDay = this.tick % p.ticksPerDay;
    if (tickOfDay === 0) {
      this.today = this.blankDay(this.day);
      for (const s of this.shops) s.cashAtDayStart = s.cash;
      this.caravan();
    }
    for (const item of RAW) {
      const cap = p.groundRegenPerDay[item] * p.groundCapacityDays;
      this.ground[item] = Math.min(cap, this.ground[item]! + p.groundRegenPerDay[item] / p.ticksPerDay);
    }
    this.produce();
    this.shopToShop();
    this.residentsShop();
    this.exportSurplus();
    this.postJobs();
    const actChance = p.activeTicksPerDay / p.ticksPerDay;
    for (const pl of this.players) if (pl.active && this.rng.chance(actChance)) this.act(pl);
    this.expireJobs();
    this.tick++;

    if (tickOfDay === p.ticksPerDay - 1) {
      this.endOfDay();
      if ((this.day) % p.daysPerWeek === 0) this.festival();
      this.recordDay();
    }
  }

  private recordDay() {
    const d = this.today;
    d.players = this.players.filter(x => x.active && x.strategy !== 'washer').length;
    d.supply = this.supply;
    d.treasury = this.treasury;
    d.shopCash = this.shops.reduce((s, x) => s + x.cash, 0);
    d.playerCash = this.players.reduce((s, x) => s + x.cash, 0);
    d.outsideCash = this.outsideCash;
    d.residentsCash = this.residentsCash;
    d.escrow = this.jobs.reduce((s, j) => s + j.escrow, 0);
    d.openShops = this.shops.filter(s => s.open).length;
    for (const item of ITEMS) {
      d.ask[item] = this.cheapestSeller(item)?.price ?? 0;
      d.bestBid[item] = this.bestBuyer(item)?.price ?? 0;
    }
    this.days.push(d);
  }

  runDays(n: number, beforeDay?: (town: Town, day: number) => void) {
    for (let i = 0; i < n; i++) {
      beforeDay?.(this, this.day);
      for (let t = 0; t < this.p.ticksPerDay; t++) this.step();
    }
  }
}
