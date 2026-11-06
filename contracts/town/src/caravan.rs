//! The caravan (RULES.md §6): an open, sealed-bid import market.
//!
//! At the end of each market day, every open shop that is short of a raw good adds an order
//! to the next day's round. During the first half of that day any account may commit a
//! sealed bid per good: sha256("<day>:<item>:<price>:<salt>:<supplier>"). In the second half
//! suppliers reveal. At the end of the day the lowest revealed price per good fills every
//! order it is within, paid from the shops' tills. The supplier keeps the price minus the
//! import cost (1.1 × reference), which goes to the outside traders: undercutting has a floor.
//!
//! Also here: the two guild hooks. Guilds are Sputnik DAOs the owner registers; players pay
//! into them, and a guild can share MERI out to its members in one call.

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId};

use crate::params::Item;
use crate::pricing::ask;
use crate::{events, sub, Town, TownExt};

/// Import cost a winning supplier pays to the outside traders, × reference price.
pub const IMPORT_COST_BPS: u128 = 11_000;
/// Rounds kept for viewing after settlement.
const KEEP_ROUNDS: u32 = 7;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Order {
    pub shop_id: String,
    pub item: Item,
    pub quantity: u64,
    /// The most this shop will pay: its own ask at the stock it had when ordering.
    pub max_price: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Bid {
    pub supplier: AccountId,
    pub item: Item,
    pub price: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Fill {
    pub shop_id: String,
    pub item: Item,
    pub quantity: u64,
    pub price: U128,
    pub supplier: AccountId,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Round {
    pub day: u32,
    pub orders: Vec<Order>,
    /// Sealed bids so far, per good (wood, ore, wheat).
    pub commits: [u32; 3],
    pub bids: Vec<Bid>,
    pub fills: Vec<Fill>,
    pub settled: bool,
}

#[near(serializers = [json])]
pub struct CaravanView {
    pub round: Option<Round>,
    /// "commit", "reveal", or "closed" for the round shown.
    pub phase: String,
    pub phase_ends_ms: u64,
    pub import_cost: [U128; 3],
    pub last: Option<Round>,
}

fn raw_index(item: Item) -> usize {
    match item {
        Item::Wood => 0,
        Item::Ore => 1,
        Item::Wheat => 2,
        _ => env::panic_str("the caravan only carries wood, ore and wheat"),
    }
}

#[near]
impl Town {
    /// Supplier: seal a bid for one good in today's round. `hash` is the hex sha256 of
    /// "<day>:<item>:<price>:<salt>:<your account>", price in micro-MERI per unit.
    pub fn caravan_commit(&mut self, item: Item, hash: String) {
        self.catch_up();
        let day = self.processed_days;
        require!(self.phase(day).0 == "commit", "bids are sealed in the first half of the day");
        let mut round = self.caravan_rounds.get(&day).cloned().unwrap_or_else(|| env::panic_str("no caravan today"));
        require!(round.orders.iter().any(|o| o.item == item), "nobody ordered that today");
        let bytes = hex(&hash);
        let key = (day, item, env::predecessor_account_id());
        if self.caravan_commits.insert(key, bytes).is_none() {
            round.commits[raw_index(item)] += 1;
        }
        self.caravan_rounds.insert(day, round);
        events::town("caravan_commit", json!({ "day": day, "item": item.id(), "supplier": env::predecessor_account_id() }));
    }

    /// Supplier: reveal a sealed bid in the second half of the day.
    pub fn caravan_reveal(&mut self, item: Item, price: U128, salt: String) {
        self.catch_up();
        let day = self.processed_days;
        require!(self.phase(day).0 == "reveal", "bids are revealed in the second half of the day");
        let supplier = env::predecessor_account_id();
        let sealed = self.caravan_commits.remove(&(day, item, supplier.clone())).unwrap_or_else(|| env::panic_str("no sealed bid from you for that"));
        let preimage = format!("{day}:{}:{}:{salt}:{supplier}", item.id(), price.0);
        require!(env::sha256(preimage.as_bytes()) == sealed, "that isn't the bid you sealed");
        require!(price.0 >= self.import_cost(item), "a bid can't be below the import cost");
        let mut round = self.caravan_rounds.get(&day).cloned().unwrap();
        round.bids.push(Bid { supplier: supplier.clone(), item, price });
        self.caravan_rounds.insert(day, round);
        events::town("caravan_reveal", json!({ "day": day, "item": item.id(), "supplier": supplier, "price": price }));
    }

    pub fn get_caravan(&self) -> CaravanView {
        let day = self.today();
        let round = self.caravan_rounds.get(&day).cloned();
        let (phase, ends) = self.phase(day);
        CaravanView {
            round,
            phase: phase.into(),
            phase_ends_ms: ends,
            import_cost: [Item::Wood, Item::Ore, Item::Wheat].map(|i| U128(self.import_cost(i))),
            last: day.checked_sub(1).and_then(|d| self.caravan_rounds.get(&d).cloned()),
        }
    }

    // ---------- guilds ----------

    /// Owner: register a guild (a Sputnik DAO) so players can pay into it.
    pub fn register_guild(&mut self, guild: AccountId) {
        self.assert_owner();
        self.guilds.insert(guild.clone());
        events::town("guild_registered", json!({ "guild": guild }));
    }

    /// Owner: retire a guild, e.g. one chartered with a policy its members can't act under.
    pub fn unregister_guild(&mut self, guild: AccountId) {
        self.assert_owner();
        require!(self.guilds.remove(&guild), "not a registered guild");
        events::town("guild_unregistered", json!({ "guild": guild }));
    }

    pub fn get_guilds(&self) -> Vec<AccountId> {
        self.guilds.iter().cloned().collect()
    }

    /// Player: pay MERI into a registered guild's treasury.
    pub fn pay_guild(&mut self, guild: AccountId, amount: U128) {
        require!(self.guilds.contains(&guild), "not a registered guild");
        require!(amount.0 > 0, "amount must be positive");
        let player = env::predecessor_account_id();
        self.move_coin(&player, &guild, amount.0, "guild contribution");
        events::town("guild_paid", json!({ "guild": guild, "player": player, "amount": amount }));
    }

    /// Guild (by DAO proposal): pay several members at once.
    pub fn share_out(&mut self, recipients: Vec<(AccountId, U128)>) {
        let guild = env::predecessor_account_id();
        require!(self.guilds.contains(&guild), "only a registered guild can share out");
        require!(recipients.len() <= 50, "at most 50 recipients");
        for (to, amount) in &recipients {
            self.move_coin(&guild, to, amount.0, "guild share-out");
        }
        events::town("guild_shared", json!({ "guild": guild, "recipients": recipients.len() }));
    }
}

impl Town {
    pub(crate) fn import_cost(&self, item: Item) -> u128 {
        self.params.base(item) * IMPORT_COST_BPS / 10_000
    }

    /// The phase of `day`'s round right now, and when it ends (ms).
    fn phase(&self, day: u32) -> (&'static str, u64) {
        let start = self.genesis_ns / 1_000_000 + day as u64 * self.params.day_ms;
        let half = start + self.params.day_ms / 2;
        let now = env::block_timestamp_ms();
        if now < half {
            ("commit", half)
        } else if now < start + self.params.day_ms {
            ("reveal", start + self.params.day_ms)
        } else {
            ("closed", start + self.params.day_ms)
        }
    }

    /// End of `day`: open the next day's round from the shops' shortages.
    pub(crate) fn open_caravan(&mut self, day: u32) {
        let mut orders = vec![];
        for s in self.shops.values() {
            if !s.open {
                continue;
            }
            let acct = sub(&s.id);
            for item in [Item::Wood, Item::Ore, Item::Wheat] {
                let target = s.target[item.idx()];
                let stock = self.items_of(&acct, item);
                if !s.buys.contains(&item) || target == 0 || stock * 2 >= target {
                    continue;
                }
                orders.push(Order {
                    shop_id: s.id.clone(),
                    item,
                    quantity: target - stock,
                    max_price: U128(ask(self.params.base(item), stock, target)),
                });
            }
        }
        if orders.is_empty() {
            return;
        }
        events::town("caravan_opened", json!({ "day": day, "orders": orders.len() }));
        self.caravan_rounds.insert(day, Round { day, orders, commits: [0; 3], bids: vec![], fills: vec![], settled: false });
        if let Some(old) = day.checked_sub(KEEP_ROUNDS) {
            self.caravan_rounds.remove(&old);
        }
    }

    /// End of `day`: the lowest revealed price per good fills the orders it's within.
    pub(crate) fn settle_caravan(&mut self, day: u32) {
        let Some(mut round) = self.caravan_rounds.get(&day).cloned() else { return };
        if round.settled {
            return;
        }
        for item in [Item::Wood, Item::Ore, Item::Wheat] {
            // Lowest price wins; on a tie, the earliest reveal.
            let Some(best) = round.bids.iter().filter(|b| b.item == item).min_by_key(|b| b.price.0).cloned() else { continue };
            let cost = self.import_cost(item);
            for o in round.orders.iter().filter(|o| o.item == item && o.max_price.0 >= best.price.0) {
                let s = self.shop(&o.shop_id);
                if !s.open {
                    continue;
                }
                let acct = sub(&o.shop_id);
                let need = s.target[item.idx()].saturating_sub(self.items_of(&acct, item));
                let affordable = (self.coin_of(&acct) / 2 / best.price.0) as u64;
                let n = o.quantity.min(need).min(affordable);
                if n == 0 {
                    continue;
                }
                let total = best.price.0 * n as u128;
                self.move_coin(&acct, &best.supplier, total - cost * n as u128, "caravan sale");
                self.move_coin(&acct, &sub("outside"), cost * n as u128, "import cost");
                self.mint_items(&acct, item, n, "imported by caravan");
                round.fills.push(Fill { shop_id: o.shop_id.clone(), item, quantity: n, price: best.price, supplier: best.supplier.clone() });
            }
        }
        round.settled = true;
        events::town("caravan_settled", json!({ "day": day, "fills": round.fills.len() }));
        self.caravan_rounds.insert(day, round);
    }
}

fn hex(s: &str) -> Vec<u8> {
    require!(s.len() == 64, "hash must be 64 hex characters");
    (0..32)
        .map(|i| u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap_or_else(|_| env::panic_str("hash must be hex")))
        .collect()
}
