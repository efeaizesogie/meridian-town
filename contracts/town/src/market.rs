//! Trading with shops (RULES.md §2), gathering from shared grounds (§4), and the views
//! the game client reads.

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId};

use crate::params::{Item, MICRO};
use crate::pricing::{ask, bid};
use crate::{events, sub, PlayerWeek, Shop, Town, TownExt};

#[near(serializers = [json])]
pub struct ShopView {
    pub shop: Shop,
    pub account: AccountId,
    pub deed_holder: AccountId,
    pub auction: Option<crate::deeds::Auction>,
    pub cash: U128,
    pub stock: [u64; 5],
    /// Price of the next unit bought from / sold to this shop; "0" where it doesn't trade.
    pub ask: [U128; 5],
    pub bid: [U128; 5],
}

#[near(serializers = [json])]
pub struct TownView {
    pub day: u32,
    pub processed_days: u32,
    pub week: u32,
    pub week_target: U128,
    pub week_counted: U128,
    pub streak: u32,
    pub best_streak: u32,
    pub treasury: U128,
    pub supply: U128,
    pub festival_pool: U128,
    pub grounds: [u64; 3],
}

#[near(serializers = [json])]
pub struct PlayerView {
    pub coins: U128,
    pub items: [u64; 5],
    pub week: PlayerWeek,
    pub claimable: U128,
}

#[near(serializers = [json])]
pub struct GatherOrder {
    pub player: AccountId,
    pub item: Item,
    pub quantity: u32,
}

#[near]
impl Town {
    /// Sell `quantity` units to a shop, one at a time at its falling bid. Fails if the
    /// total would come to less than `min_total` (before the 2% trade tax).
    pub fn sell(&mut self, shop_id: String, item: Item, quantity: u32, min_total: U128) -> U128 {
        self.catch_up();
        let player = env::predecessor_account_id();
        let (s, acct) = self.open_shop(&shop_id);
        require!(s.buys.contains(&item), "this shop doesn't buy that");
        require!(quantity > 0, "quantity must be positive");
        let total = self.quote(&s, &acct, item, quantity, true);
        require!(total >= min_total.0, "price moved below min_total");
        let tax = total * self.params.trade_tax_bps as u128 / 10_000;

        self.move_items(&player, &acct, item, quantity as u64, Some("sold to shop"));
        self.move_coin(&acct, &player, total - tax, "shop purchase");
        self.move_coin(&acct, &env::current_account_id(), tax, "trade tax");
        self.record_volume(&player, total);
        events::town("trade", json!({
            "player": player, "shop": shop_id, "side": "sell", "item": item.id(),
            "quantity": quantity, "total": U128(total), "tax": U128(tax),
        }));
        U128(total - tax)
    }

    /// Buy `quantity` units from a shop at its rising ask, plus the 2% trade tax.
    pub fn buy(&mut self, shop_id: String, item: Item, quantity: u32, max_total: U128) -> U128 {
        self.catch_up();
        let player = env::predecessor_account_id();
        let (s, acct) = self.open_shop(&shop_id);
        require!(s.sells.contains(&item), "this shop doesn't sell that");
        require!(quantity > 0, "quantity must be positive");
        let total = self.quote(&s, &acct, item, quantity, false);
        let tax = total * self.params.trade_tax_bps as u128 / 10_000;
        require!(total + tax <= max_total.0, "price moved above max_total");

        self.move_coin(&player, &acct, total, "bought from shop");
        self.move_coin(&player, &env::current_account_id(), tax, "trade tax");
        self.move_items(&acct, &player, item, quantity as u64, Some("bought from shop"));
        self.record_volume(&player, total);
        events::town("trade", json!({
            "player": player, "shop": shop_id, "side": "buy", "item": item.id(),
            "quantity": quantity, "total": U128(total), "tax": U128(tax),
        }));
        U128(total + tax)
    }

    /// Game server only: credit gathered goods, limited by what the ground has regrown.
    /// Returns how many units were actually gathered.
    pub fn gather(&mut self, player: AccountId, item: Item, quantity: u32) -> u32 {
        require!(env::predecessor_account_id() == self.minter, "minter only");
        self.gather_one(&player, item, quantity)
    }

    pub fn gather_batch(&mut self, orders: Vec<GatherOrder>) -> Vec<u32> {
        require!(env::predecessor_account_id() == self.minter, "minter only");
        orders.into_iter().map(|o| self.gather_one(&o.player, o.item, o.quantity)).collect()
    }

    /// Use up goods: bread restores stamina, a tool lasts a number of swings. The game
    /// server credits the effect once it has seen this transaction succeed.
    pub fn use_item(&mut self, item: Item, quantity: u32) {
        require!(matches!(item, Item::Bread | Item::Tool), "only bread and tools can be used");
        require!(quantity >= 1 && quantity <= 20, "use 1 to 20 at a time");
        let player = env::predecessor_account_id();
        self.burn_items(&player, item, quantity as u64, "used");
        events::town("item_used", json!({ "player": player, "item": item.id(), "quantity": quantity }));
    }

    /// Anyone can push the town's clock forward (upkeep, production, festival).
    pub fn advance(&mut self) -> u32 {
        self.catch_up_by(crate::days::ADVANCE_DAYS_PER_CALL);
        self.processed_days
    }

    // ---------- views ----------

    pub fn quote_sell(&self, shop_id: String, item: Item, quantity: u32) -> U128 {
        let s = self.shop(&shop_id);
        U128(self.quote(&s, &sub(&s.id), item, quantity, true))
    }

    pub fn quote_buy(&self, shop_id: String, item: Item, quantity: u32) -> U128 {
        let s = self.shop(&shop_id);
        let total = self.quote(&s, &sub(&s.id), item, quantity, false);
        U128(total + total * self.params.trade_tax_bps as u128 / 10_000)
    }

    /// How many units this shop will buy right now (up to 1,000) before it is full or out of cash.
    pub fn sell_capacity(&self, shop_id: String, item: Item) -> u32 {
        let s = self.shop(&shop_id);
        if !s.open || !s.buys.contains(&item) {
            return 0;
        }
        let acct = sub(&s.id);
        let (base, target) = (self.params.base(item), s.target[item.idx()]);
        let (mut stock, mut cash, mut n) = (self.items_of(&acct, item), self.coin_of(&acct), 0);
        while n < 1_000 {
            let b = bid(&self.params, base, stock, target, cash);
            if b == 0 {
                break;
            }
            stock += 1;
            cash -= b;
            n += 1;
        }
        n
    }

    pub fn get_shops(&self) -> Vec<ShopView> {
        self.shops
            .values()
            .map(|s| {
                let acct = sub(&s.id);
                let cash = self.coin_of(&acct);
                let mut view = ShopView {
                    shop: s.clone(),
                    account: acct.clone(),
                    deed_holder: self.deed_owner(&s.id),
                    auction: self.auctions.get(&s.id).cloned(),
                    cash: U128(cash),
                    stock: [0; 5],
                    ask: [U128(0); 5],
                    bid: [U128(0); 5],
                };
                for item in Item::ALL {
                    let (i, stock, target) = (item.idx(), self.items_of(&acct, item), s.target[item.idx()]);
                    view.stock[i] = stock;
                    if s.open && s.sells.contains(&item) && stock > 0 {
                        view.ask[i] = U128(ask(self.params.base(item), stock, target));
                    }
                    if s.open && s.buys.contains(&item) {
                        view.bid[i] = U128(bid(&self.params, self.params.base(item), stock, target, cash));
                    }
                }
                view
            })
            .collect()
    }

    /// Genesis and day length, so clients can show a live market clock.
    pub fn get_clock(&self) -> (u64, u64, u64) {
        (self.genesis_ns / 1_000_000, self.params.day_ms, env::block_timestamp_ms())
    }

    pub fn get_town(&self) -> TownView {
        let mut grounds = [0u64; 3];
        for (i, g) in grounds.iter_mut().enumerate() {
            *g = (self.ground_now(i) / MICRO) as u64;
        }
        TownView {
            day: self.today(),
            processed_days: self.processed_days,
            week: self.processed_days / self.params.days_per_week,
            week_target: U128(self.week_target),
            week_counted: U128(self.week_counted),
            streak: self.streak,
            best_streak: self.best_streak,
            treasury: U128(self.coin_of(&env::current_account_id())),
            supply: U128(self.coin.total_supply),
            festival_pool: U128(self.coin_of(&sub("festival"))),
            grounds,
        }
    }

    pub fn get_player(&self, account_id: AccountId) -> PlayerView {
        let mut items = [0u64; 5];
        for item in Item::ALL {
            items[item.idx()] = self.items_of(&account_id, item);
        }
        let week = self.player_weeks.get(&account_id).cloned().unwrap_or_default();
        PlayerView { coins: U128(self.coin_of(&account_id)), items, claimable: U128(self.claimable(&week)), week }
    }
}

impl Town {
    fn open_shop(&self, id: &str) -> (Shop, AccountId) {
        let s = self.shop(id);
        require!(s.open, "shop is closed");
        let acct = sub(&s.id);
        (s, acct)
    }

    /// Total price of `quantity` units, walking the price curve one unit at a time.
    pub(crate) fn quote(&self, s: &Shop, acct: &AccountId, item: Item, quantity: u32, shop_buys: bool) -> u128 {
        let (base, target) = (self.params.base(item), s.target[item.idx()]);
        let mut stock = self.items_of(acct, item);
        let mut cash = self.coin_of(acct);
        let mut total = 0u128;
        for _ in 0..quantity {
            if shop_buys {
                let b = bid(&self.params, base, stock, target, cash);
                require!(b > 0, "the shop won't buy that many");
                total += b;
                stock += 1;
                cash -= b;
            } else {
                require!(stock > 0, "the shop doesn't have that many");
                total += ask(base, stock, target);
                stock -= 1;
            }
        }
        total
    }

    fn gather_one(&mut self, player: &AccountId, item: Item, quantity: u32) -> u32 {
        require!(item.is_raw(), "only wood, ore and wheat can be gathered");
        let i = item.idx();
        let available = self.ground_now(i);
        let n = (quantity as u128).min(available / MICRO);
        self.grounds[i].micro_units = U128(available - n * MICRO);
        self.grounds[i].updated_ns = env::block_timestamp();
        self.mint_items(player, item, n as u64, "gathered");
        n as u32
    }

    /// Ground level right now, including regrowth since the last update.
    pub(crate) fn ground_now(&self, i: usize) -> u128 {
        let g = &self.grounds[i];
        let elapsed = env::block_timestamp().saturating_sub(g.updated_ns) as u128;
        let grown = self.params.ground_regen_per_day[i] as u128 * MICRO * elapsed / self.params.day_ns() as u128;
        (g.micro_units.0 + grown).min(self.ground_capacity(i))
    }

    pub(crate) fn contribution(&self, volume: u128) -> u128 {
        if volume < self.params.min_qualifying_volume.0 {
            0
        } else {
            volume.min(self.params.player_volume_cap.0)
        }
    }

    /// Add to a player's counted volume for the current market week (RULES.md §7).
    pub(crate) fn record_volume(&mut self, player: &AccountId, amount: u128) {
        let week = self.processed_days / self.params.days_per_week;
        let mut pw = self.player_weeks.get(player).cloned().unwrap_or_default();
        if pw.week != week {
            self.pay_claim(player, &pw);
            pw = PlayerWeek { week, volume: U128(0) };
        }
        let before = self.contribution(pw.volume.0);
        pw.volume = U128(pw.volume.0 + amount);
        self.week_counted += self.contribution(pw.volume.0) - before;
        self.player_weeks.insert(player.clone(), pw);
    }
}
