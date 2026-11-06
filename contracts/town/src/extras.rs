//! V4: social money, memecoin sinks and NFT utility, all inside the town contract so every
//! coin stays accounted for.
//!
//! - Tips: send MERI to another player with a note (play keys can't attach the 1 yocto that
//!   `ft_transfer` needs, so the town offers its own transfer).
//! - Burn to boost: burn MERI for a town-wide moment (fireworks, a market bell, a banner).
//! - The Festival prediction pool: stake on hit or miss; winners split the pot, 2% burns.
//! - Shop coins: each shop has a coin on a bonding curve priced in MERI. Holders earn a share
//!   of the shop's daily profit; every buy and sell burns 2.5%.
//! - The weekly tournament: enter for a fixed fee; the biggest single sale of the week wins
//!   the pot (5% burns). No winner rolls the pot into next week.
//! - Festival badges (collectible NFTs), marks of the trade (soulbound NFTs) and crafted
//!   tools (tradeable NFTs with on-chain durability that add yield when gathering).
//!
//! Escrow lives in internal ledger accounts: `bets.<town>`, `coins.<town>`, `tourney.<town>`.

use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::TokenMetadata;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::store::{IterableMap, LookupMap, Vector};
use near_sdk::{env, near, require, AccountId};

use crate::params::{Item, MICRO};
use crate::{events, sub, Key, Town, TownExt};

// ---------- the numbers ----------

pub const MIN_TIP: u128 = MICRO / 100;
pub const BOOST_FIREWORKS: u128 = 5 * MICRO;
pub const BOOST_BELL: u128 = 10 * MICRO;
pub const BOOST_BANNER: u128 = 20 * MICRO;
/// Bets close this many market days before the week ends, so nobody bets on a known result.
pub const BET_CLOSE_DAYS: u32 = 2;
pub const MIN_BET: u128 = MICRO;
pub const BET_FEE_BPS: u128 = 200;
/// Shop coins: the k-th coin costs BASE + STEP × k MERI.
pub const COIN_BASE: u128 = MICRO;
pub const COIN_STEP: u128 = MICRO / 50;
pub const COIN_FEE_BPS: u128 = 250;
pub const COIN_MAX_PER_TX: u32 = 100;
/// Share of a shop's daily profit paid to its coin holders.
pub const COIN_DIVIDEND_BPS: u128 = 2_000;
const ACC_SCALE: u128 = 1_000_000_000_000;
pub const TOURNEY_ENTRY: u128 = 5 * MICRO;
pub const TOURNEY_BURN_BPS: u128 = 500;
/// Share of the trade tax at a shop that goes to its deed holder (when a player holds it).
pub const DEED_TAX_BPS: u128 = 2_500;
pub const TOOL_USES: u32 = 60;

// ---------- stored shapes ----------

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Boost {
    pub who: AccountId,
    pub kind: String,
    pub item: Option<Item>,
    pub text: Option<String>,
    pub burned: U128,
    pub at_ns: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct Bet {
    pub hit: U128,
    pub miss: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct Pool {
    pub hit: U128,
    pub miss: U128,
    pub settled: bool,
    pub outcome_hit: bool,
    /// What the winning side shares, after the fee.
    pub payout: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct ShopCoin {
    pub supply: u64,
    pub reserve: U128,
    /// Dividends per coin, scaled by 1e12, accumulated since launch.
    pub acc: U128,
    pub dividends: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct Holding {
    pub coins: u64,
    pub acc_seen: U128,
    pub owed: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct Tourney {
    pub week: u32,
    pub pot: U128,
    pub entrants: u32,
    pub leader: Option<AccountId>,
    pub best: U128,
    pub settled: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct ToolInfo {
    pub kind: String,
    pub item: Item,
    pub uses_left: u32,
}

#[near(serializers = [borsh])]
pub struct Extras {
    pub boosts: Vector<Boost>,
    pub bets: LookupMap<(u32, AccountId), Bet>,
    pub pools: LookupMap<u32, Pool>,
    pub coins: IterableMap<String, ShopCoin>,
    pub holdings: LookupMap<(String, AccountId), Holding>,
    pub tourneys: LookupMap<u32, Tourney>,
    pub entries: LookupMap<(u32, AccountId), U128>,
    pub tools: LookupMap<String, ToolInfo>,
    pub next_tool: u64,
}

impl Extras {
    pub fn new() -> Self {
        Self {
            boosts: Vector::new(Key::Boosts),
            bets: LookupMap::new(Key::Bets),
            pools: LookupMap::new(Key::Pools),
            coins: IterableMap::new(Key::Coins),
            holdings: LookupMap::new(Key::Holdings),
            tourneys: LookupMap::new(Key::Tourneys),
            entries: LookupMap::new(Key::Entries),
            tools: LookupMap::new(Key::Tools),
            next_tool: 1,
        }
    }
}

/// Price of `n` coins starting at supply `s` on the bonding curve.
pub fn curve_cost(s: u64, n: u64) -> u128 {
    let (s, n) = (s as u128, n as u128);
    n * COIN_BASE + COIN_STEP * (n * s + n * n.saturating_sub(1) / 2)
}

// ---------- views ----------

#[near(serializers = [json])]
pub struct PredictionView {
    pub week: u32,
    pub open: bool,
    pub pool: Pool,
    pub mine: Bet,
}

#[near(serializers = [json])]
pub struct ShopCoinView {
    pub shop_id: String,
    pub supply: u64,
    pub reserve: U128,
    /// Price of the next coin bought (before the fee).
    pub next_price: U128,
    pub dividends: U128,
}

#[near(serializers = [json])]
pub struct HoldingView {
    pub shop_id: String,
    pub coins: u64,
    pub claimable: U128,
    /// What selling every coin would return now, after the fee.
    pub value: U128,
}

#[near(serializers = [json])]
pub struct ToolView {
    pub token_id: String,
    pub owner: AccountId,
    pub kind: String,
    pub item: Item,
    pub uses_left: u32,
}

#[near]
impl Town {
    // ---------- tips ----------

    /// Send MERI to another player, with an optional note that shows in the town feed.
    pub fn tip(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) -> U128 {
        let from = env::predecessor_account_id();
        require!(receiver_id != from, "you can't tip yourself");
        require!(amount.0 >= MIN_TIP, "tips start at 0.01 MERI");
        let memo = memo.map(|m| m.chars().take(80).collect::<String>());
        self.move_coin(&from, &receiver_id, amount.0, "tip");
        events::town("tip", json!({ "from": from, "to": receiver_id, "amount": amount, "memo": memo }));
        amount
    }

    // ---------- burn to boost ----------

    /// Burn MERI for a town-wide moment: "fireworks" (5), "bell" for a raw good (10), or a
    /// "banner" with your words on the Festival stage (20). Returns what was burned.
    pub fn burn_for_boost(&mut self, kind: String, item: Option<Item>, text: Option<String>) -> U128 {
        self.catch_up();
        let who = env::predecessor_account_id();
        let cost = match kind.as_str() {
            "fireworks" => BOOST_FIREWORKS,
            "bell" => {
                require!(item.map(|i| i.is_raw()).unwrap_or(false), "ring the bell for wood, ore or wheat");
                BOOST_BELL
            }
            "banner" => {
                let t = text.as_deref().unwrap_or("").trim();
                require!(!t.is_empty() && t.chars().count() <= 24, "a banner needs 1 to 24 characters");
                BOOST_BANNER
            }
            _ => env::panic_str("unknown boost"),
        };
        self.burn_coin(&who, cost, &format!("boost: {kind}"));
        let text = text.map(|t| t.trim().chars().take(24).collect::<String>());
        let b = Boost { who: who.clone(), kind: kind.clone(), item, text: text.clone(), burned: U128(cost), at_ns: env::block_timestamp() };
        self.extras.boosts.push(b);
        events::town("boost", json!({ "who": who, "kind": kind, "item": item.map(|i| i.id()), "text": text, "burned": U128(cost) }));
        U128(cost)
    }

    /// The most recent boosts, newest first.
    pub fn get_boosts(&self, limit: Option<u32>) -> Vec<Boost> {
        let n = self.extras.boosts.len();
        let k = limit.unwrap_or(20).min(50);
        (n.saturating_sub(k)..n).rev().filter_map(|i| self.extras.boosts.get(i).cloned()).collect()
    }

    // ---------- the Festival prediction pool ----------

    /// Stake MERI on whether this week's Festival is hit. Bets close two days before the week ends.
    pub fn predict(&mut self, hit: bool, amount: U128) -> U128 {
        self.catch_up();
        let who = env::predecessor_account_id();
        require!(amount.0 >= MIN_BET, "bets start at 1 MERI");
        let dpw = self.params.days_per_week;
        let week = self.processed_days / dpw;
        require!(self.today() % dpw < dpw - BET_CLOSE_DAYS && self.today() / dpw == week, "betting on this week has closed");
        self.move_coin(&who, &sub("bets"), amount.0, "prediction stake");
        let mut bet = self.extras.bets.get(&(week, who.clone())).cloned().unwrap_or_default();
        let mut pool = self.extras.pools.get(&week).cloned().unwrap_or_default();
        if hit {
            bet.hit = U128(bet.hit.0 + amount.0);
            pool.hit = U128(pool.hit.0 + amount.0);
        } else {
            bet.miss = U128(bet.miss.0 + amount.0);
            pool.miss = U128(pool.miss.0 + amount.0);
        }
        self.extras.bets.insert((week, who.clone()), bet);
        self.extras.pools.insert(week, pool);
        events::town("prediction", json!({ "who": who, "week": week, "hit": hit, "amount": amount }));
        amount
    }

    /// Collect winnings from a settled week. Returns what was paid.
    pub fn claim_prediction(&mut self, week: u32) -> U128 {
        self.catch_up();
        let who = env::predecessor_account_id();
        let pool = self.extras.pools.get(&week).cloned().unwrap_or_else(|| env::panic_str("no bets that week"));
        require!(pool.settled, "that week hasn't ended yet");
        let Some(bet) = self.extras.bets.remove(&(week, who.clone())) else { return U128(0) };
        let (mine, side) = if pool.outcome_hit { (bet.hit.0, pool.hit.0) } else { (bet.miss.0, pool.miss.0) };
        if mine == 0 || side == 0 {
            return U128(0);
        }
        let paid = pool.payout.0 * mine / side;
        self.move_coin(&sub("bets"), &who, paid, "prediction winnings");
        events::town("prediction_paid", json!({ "who": who, "week": week, "paid": U128(paid) }));
        U128(paid)
    }

    pub fn get_prediction(&self, week: Option<u32>, account_id: Option<AccountId>) -> PredictionView {
        let dpw = self.params.days_per_week;
        let week = week.unwrap_or(self.today() / dpw);
        PredictionView {
            week,
            open: self.today() / dpw == week && self.today() % dpw < dpw - BET_CLOSE_DAYS,
            pool: self.extras.pools.get(&week).cloned().unwrap_or_default(),
            mine: account_id.and_then(|a| self.extras.bets.get(&(week, a)).cloned()).unwrap_or_default(),
        }
    }

    // ---------- shop coins ----------

    /// Buy `coins` of a shop's coin on its bonding curve. Pays the curve price plus a 2.5% burn.
    pub fn buy_shop_coin(&mut self, shop_id: String, coins: u32, max_total: U128) -> U128 {
        self.catch_up();
        let who = env::predecessor_account_id();
        require!(self.shop(&shop_id).open, "this shop is closed");
        require!(coins >= 1 && coins <= COIN_MAX_PER_TX, "buy 1 to 100 coins at a time");
        let mut c = self.extras.coins.get(&shop_id).cloned().unwrap_or_default();
        let cost = curve_cost(c.supply, coins as u64);
        let fee = cost * COIN_FEE_BPS / 10_000;
        require!(cost + fee <= max_total.0, "price moved above max_total");
        self.move_coin(&who, &sub("coins"), cost, "shop coin");
        self.burn_coin(&who, fee, "shop coin fee");
        self.settle_holding(&shop_id, &who, &c);
        let mut h = self.extras.holdings.get(&(shop_id.clone(), who.clone())).cloned().unwrap_or_default();
        h.coins += coins as u64;
        self.extras.holdings.insert((shop_id.clone(), who.clone()), h);
        c.supply += coins as u64;
        c.reserve = U128(c.reserve.0 + cost);
        self.extras.coins.insert(shop_id.clone(), c.clone());
        events::town("shop_coin", json!({ "who": who, "shop": shop_id, "side": "buy", "coins": coins, "total": U128(cost + fee), "burned": U128(fee), "supply": c.supply }));
        U128(cost + fee)
    }

    /// Sell coins back to the curve. Returns the curve value minus a 2.5% burn.
    pub fn sell_shop_coin(&mut self, shop_id: String, coins: u32, min_return: U128) -> U128 {
        self.catch_up();
        let who = env::predecessor_account_id();
        require!(coins >= 1 && coins <= COIN_MAX_PER_TX, "sell 1 to 100 coins at a time");
        let mut c = self.extras.coins.get(&shop_id).cloned().unwrap_or_default();
        self.settle_holding(&shop_id, &who, &c);
        let key = (shop_id.clone(), who.clone());
        let mut h = self.extras.holdings.get(&key).cloned().unwrap_or_default();
        require!(h.coins >= coins as u64, "you don't hold that many");
        let value = curve_cost(c.supply - coins as u64, coins as u64);
        let fee = value * COIN_FEE_BPS / 10_000;
        require!(value - fee >= min_return.0, "price moved below min_return");
        h.coins -= coins as u64;
        self.extras.holdings.insert(key, h);
        c.supply -= coins as u64;
        c.reserve = U128(c.reserve.0 - value);
        self.extras.coins.insert(shop_id.clone(), c.clone());
        self.move_coin(&sub("coins"), &who, value - fee, "shop coin sold");
        self.burn_coin(&sub("coins"), fee, "shop coin fee");
        events::town("shop_coin", json!({ "who": who, "shop": shop_id, "side": "sell", "coins": coins, "total": U128(value - fee), "burned": U128(fee), "supply": c.supply }));
        U128(value - fee)
    }

    /// Collect the dividends a shop's coins have earned you.
    pub fn claim_coin_dividends(&mut self, shop_id: String) -> U128 {
        self.catch_up();
        let who = env::predecessor_account_id();
        let c = self.extras.coins.get(&shop_id).cloned().unwrap_or_default();
        self.settle_holding(&shop_id, &who, &c);
        let key = (shop_id.clone(), who.clone());
        let mut h = self.extras.holdings.get(&key).cloned().unwrap_or_default();
        let owed = h.owed.0;
        h.owed = U128(0);
        self.extras.holdings.insert(key, h);
        self.move_coin(&sub("coins"), &who, owed, "shop coin dividend");
        U128(owed)
    }

    pub fn get_shop_coins(&self) -> Vec<ShopCoinView> {
        self.shops
            .keys()
            .map(|id| {
                let c = self.extras.coins.get(id).cloned().unwrap_or_default();
                ShopCoinView { shop_id: id.clone(), supply: c.supply, reserve: c.reserve, next_price: U128(curve_cost(c.supply, 1)), dividends: c.dividends }
            })
            .collect()
    }

    pub fn get_coin_holdings(&self, account_id: AccountId) -> Vec<HoldingView> {
        self.shops
            .keys()
            .filter_map(|id| {
                let h = self.extras.holdings.get(&(id.clone(), account_id.clone()))?;
                let c = self.extras.coins.get(id).cloned().unwrap_or_default();
                let fresh = h.coins as u128 * (c.acc.0 - h.acc_seen.0) / ACC_SCALE;
                let value = if h.coins > 0 { curve_cost(c.supply - h.coins, h.coins) } else { 0 };
                Some(HoldingView { shop_id: id.clone(), coins: h.coins, claimable: U128(h.owed.0 + fresh), value: U128(value - value * COIN_FEE_BPS / 10_000) })
            })
            .filter(|h| h.coins > 0 || h.claimable.0 > 0)
            .collect()
    }

    // ---------- the weekly tournament ----------

    /// Enter this week's tournament (5 MERI into the pot). Your biggest single sale this week counts.
    pub fn enter_tournament(&mut self) -> u32 {
        self.catch_up();
        let who = env::predecessor_account_id();
        let week = self.processed_days / self.params.days_per_week;
        require!(self.extras.entries.get(&(week, who.clone())).is_none(), "you're already in this week's tournament");
        self.move_coin(&who, &sub("tourney"), TOURNEY_ENTRY, "tournament entry");
        self.extras.entries.insert((week, who.clone()), U128(0));
        let mut t = self.tourney(week);
        t.pot = U128(t.pot.0 + TOURNEY_ENTRY);
        t.entrants += 1;
        self.extras.tourneys.insert(week, t.clone());
        events::town("tournament_entry", json!({ "who": who, "week": week, "pot": t.pot }));
        t.entrants
    }

    pub fn get_tournament(&self, week: Option<u32>, account_id: Option<AccountId>) -> (Tourney, Option<U128>) {
        let week = week.unwrap_or(self.processed_days / self.params.days_per_week);
        let mine = account_id.and_then(|a| self.extras.entries.get(&(week, a)).cloned());
        (self.tourney(week), mine)
    }

    // ---------- NFTs: marks, tools ----------

    /// Game server: record a mark of the trade as a soulbound NFT in the player's account.
    pub fn mint_mark(&mut self, player: AccountId, mark: String) -> bool {
        require!(env::predecessor_account_id() == self.minter, "minter only");
        require!(!mark.is_empty() && mark.len() <= 24 && mark.chars().all(|c| c.is_ascii_alphanumeric()), "bad mark id");
        let id = format!("mark-{mark}-{player}");
        if self.deeds.owner_by_id.contains_key(&id) {
            return false;
        }
        let meta = TokenMetadata {
            title: Some(format!("Mark of the trade: {mark}")),
            description: Some("Earned in Meridian Town. Soulbound: it stays with the player who earned it.".into()),
            extra: Some(json!({ "kind": "mark", "mark": mark, "soulbound": true }).to_string()),
            ..Default::default()
        };
        self.mint_collectible(id, &player, meta, "mark")
    }

    /// Forge a tool NFT from goods and MERI: an "axe" (wood), a "pick" (ore) or a "sickle" (wheat).
    /// It adds one unit per swing at its ground for 60 swings, and can be traded.
    pub fn craft_tool(&mut self, kind: String) -> String {
        self.catch_up();
        let who = env::predecessor_account_id();
        let (item, wood, ore, title) = match kind.as_str() {
            "axe" => (Item::Wood, 4u64, 6u64, "Silver Axe"),
            "pick" => (Item::Ore, 6, 4, "Iron Pick"),
            "sickle" => (Item::Wheat, 5, 5, "Golden Sickle"),
            _ => env::panic_str("craft an axe, a pick or a sickle"),
        };
        self.burn_items(&who, Item::Wood, wood, "crafted");
        self.burn_items(&who, Item::Ore, ore, "crafted");
        self.burn_coin(&who, 5 * MICRO, "crafting fee");
        let n = self.extras.next_tool;
        self.extras.next_tool += 1;
        let id = format!("tool-{n}");
        let meta = TokenMetadata {
            title: Some(format!("{title} #{n}")),
            description: Some(format!("Forged in Meridian Town. Each swing at its ground gathers one extra {} until it wears out.", item.id())),
            extra: Some(json!({ "kind": kind, "item": item.id(), "uses": TOOL_USES }).to_string()),
            ..Default::default()
        };
        self.extras.tools.insert(id.clone(), ToolInfo { kind, item, uses_left: TOOL_USES });
        self.mint_collectible(id.clone(), &who, meta, "crafted");
        id
    }

    pub fn get_tools(&self, account_id: AccountId) -> Vec<ToolView> {
        use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
        self.deeds
            .nft_tokens_for_owner(account_id.clone(), None, Some(200))
            .into_iter()
            .filter_map(|t| {
                let info = self.extras.tools.get(&t.token_id)?;
                Some(ToolView { token_id: t.token_id.clone(), owner: account_id.clone(), kind: info.kind.clone(), item: info.item, uses_left: info.uses_left })
            })
            .collect()
    }
}

impl Town {
    pub(crate) fn tourney(&self, week: u32) -> Tourney {
        self.extras.tourneys.get(&week).cloned().unwrap_or(Tourney { week, ..Default::default() })
    }

    /// Bring a holder's dividends up to date before their coin count changes.
    fn settle_holding(&mut self, shop_id: &str, who: &AccountId, c: &ShopCoin) {
        let key = (shop_id.to_string(), who.clone());
        let mut h = self.extras.holdings.get(&key).cloned().unwrap_or_default();
        h.owed = U128(h.owed.0 + h.coins as u128 * (c.acc.0 - h.acc_seen.0) / ACC_SCALE);
        h.acc_seen = c.acc;
        self.extras.holdings.insert(key, h);
    }

    /// From pay_dividends: a share of a shop's profit to its coin holders. Returns what was paid.
    pub(crate) fn pay_coin_dividends(&mut self, shop_id: &str, profit: u128, available: u128) -> u128 {
        let Some(mut c) = self.extras.coins.get(shop_id).cloned() else { return 0 };
        if c.supply == 0 {
            return 0;
        }
        let amount = (profit * COIN_DIVIDEND_BPS / 10_000).min(available);
        if amount == 0 {
            return 0;
        }
        self.move_coin(&sub(shop_id), &sub("coins"), amount, "shop coin dividend");
        c.acc = U128(c.acc.0 + amount * ACC_SCALE / c.supply as u128);
        c.dividends = U128(c.dividends.0 + amount);
        self.extras.coins.insert(shop_id.to_string(), c);
        amount
    }

    /// From sell(): track tournament entrants' biggest single sale.
    pub(crate) fn tourney_sale(&mut self, player: &AccountId, total: u128) {
        let week = self.processed_days / self.params.days_per_week;
        let key = (week, player.clone());
        let Some(best) = self.extras.entries.get(&key).cloned() else { return };
        if total <= best.0 {
            return;
        }
        self.extras.entries.insert(key, U128(total));
        let mut t = self.tourney(week);
        if total > t.best.0 {
            t.best = U128(total);
            t.leader = Some(player.clone());
            self.extras.tourneys.insert(week, t);
        }
    }

    /// From festival(): settle the week's predictions and tournament.
    pub(crate) fn settle_week_extras(&mut self, week: u32, hit: bool) {
        if let Some(mut pool) = self.extras.pools.get(&week).cloned() {
            if !pool.settled {
                let total = pool.hit.0 + pool.miss.0;
                let winners = if hit { pool.hit.0 } else { pool.miss.0 };
                let fee = if winners == 0 { total } else { total * BET_FEE_BPS / 10_000 };
                self.burn_coin(&sub("bets"), fee, "prediction pool fee");
                pool.settled = true;
                pool.outcome_hit = hit;
                pool.payout = U128(total - fee);
                self.extras.pools.insert(week, pool.clone());
                events::town("prediction_settled", json!({ "week": week, "hit": hit, "pool": U128(total), "burned": U128(fee) }));
            }
        }
        let mut t = self.tourney(week);
        if !t.settled && t.pot.0 > 0 {
            if let Some(leader) = t.leader.clone() {
                let burn = t.pot.0 * TOURNEY_BURN_BPS / 10_000;
                self.burn_coin(&sub("tourney"), burn, "tournament burn");
                self.move_coin(&sub("tourney"), &leader, t.pot.0 - burn, "tournament prize");
                events::town("tournament_won", json!({ "week": week, "winner": leader, "prize": U128(t.pot.0 - burn), "best_sale": t.best }));
            } else {
                // Nobody sold: the pot rolls into next week.
                let mut next = self.tourney(week + 1);
                next.pot = U128(next.pot.0 + t.pot.0);
                self.extras.tourneys.insert(week + 1, next);
            }
            t.settled = true;
            self.extras.tourneys.insert(week, t);
        }
    }

    /// From claim_festival: a collectible badge for each Festival week a player shared in.
    pub(crate) fn mint_festival_badge(&mut self, player: &AccountId, week: u32) {
        let id = format!("festival-{}-{player}", week + 1);
        if self.deeds.owner_by_id.contains_key(&id) {
            return;
        }
        let meta = TokenMetadata {
            title: Some(format!("Festival of week {}", week + 1)),
            description: Some("The town hit its trading target and this player traded in it. A keepsake from Meridian Town.".into()),
            extra: Some(json!({ "kind": "festival", "week": week + 1 }).to_string()),
            ..Default::default()
        };
        self.mint_collectible(id, player, meta, "festival");
    }

    fn mint_collectible(&mut self, id: String, owner: &AccountId, meta: TokenMetadata, memo: &str) -> bool {
        self.deeds.internal_mint_with_refund(id.clone(), owner.clone(), Some(meta), None);
        NftMint { owner_id: owner, token_ids: &[&id], memo: Some(memo) }.emit();
        true
    }

    /// From gather_batch: a tool the player holds adds one unit per swing at its ground.
    pub(crate) fn tool_bonus(&mut self, player: &AccountId, tool: &str, item: Item, swings: u32) -> u32 {
        let Some(mut info) = self.extras.tools.get(tool).cloned() else { return 0 };
        if info.item != item || info.uses_left == 0 || self.deeds.owner_by_id.get(&tool.to_string()).as_ref() != Some(player) {
            return 0;
        }
        let bonus = swings.min(info.uses_left);
        info.uses_left -= bonus;
        self.extras.tools.insert(tool.to_string(), info);
        bonus
    }

    /// Soulbound marks can't move; everything else (badges, tools) trades freely.
    pub(crate) fn is_soulbound(token_id: &str) -> bool {
        token_id.starts_with("mark-")
    }
}
