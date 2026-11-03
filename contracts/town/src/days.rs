//! The town clock: end-of-day upkeep and production, and the weekly Festival (RULES.md §3, §7).
//! Deed auctions settle and dividends are paid here too. Residents and the caravan come next.

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, AccountId};

use crate::params::Item;
use crate::deeds::AuctionKind;
use crate::{events, sub, PlayerWeek, Town, TownExt, WeekResult};

/// At most this many days are processed per call, to stay inside the gas limit.
const MAX_DAYS_PER_CALL: u32 = 14;

#[near]
impl Town {
    /// Pay out the caller's share of every finished Festival they traded in.
    pub fn claim_festival(&mut self) -> U128 {
        self.catch_up();
        let player = env::predecessor_account_id();
        let week = self.processed_days / self.params.days_per_week;
        let pw = self.player_weeks.get(&player).cloned().unwrap_or_default();
        if pw.week >= week {
            return U128(0);
        }
        let paid = self.pay_claim(&player, &pw);
        self.player_weeks.insert(player, PlayerWeek { week, volume: U128(0) });
        U128(paid)
    }

    pub fn get_weeks(&self, from: Option<u32>, limit: Option<u32>) -> Vec<WeekResult> {
        let from = from.unwrap_or(0);
        let limit = limit.unwrap_or(52);
        (from..self.weeks.len().min(from + limit)).filter_map(|i| self.weeks.get(i).cloned()).collect()
    }
}

impl Town {
    pub(crate) fn today(&self) -> u32 {
        ((env::block_timestamp() - self.genesis_ns) / self.params.day_ns()) as u32
    }

    pub(crate) fn catch_up(&mut self) {
        let today = self.today();
        let mut n = 0;
        while self.processed_days < today && n < MAX_DAYS_PER_CALL {
            self.end_day();
            self.processed_days += 1;
            if self.processed_days % self.params.days_per_week == 0 {
                self.festival(self.processed_days / self.params.days_per_week - 1);
            }
            n += 1;
        }
    }

    fn end_day(&mut self) {
        let day = self.processed_days;
        self.produce("smith", &[Item::Wood, Item::Ore], Item::Tool, self.params.blacksmith_capacity);
        self.produce("baker", &[Item::Wheat], Item::Bread, self.params.baker_capacity);
        self.settle_caravan(day);
        self.settle_auctions(day);
        self.collect_upkeep(day);
        self.pay_dividends();
        self.open_caravan(day + 1);
    }

    fn produce(&mut self, shop_id: &str, inputs: &[Item], output: Item, capacity: u64) {
        let s = self.shop(shop_id);
        if !s.open {
            return;
        }
        let acct = sub(shop_id);
        let room = (s.target[output.idx()] * self.params.max_stock_mult as u64).saturating_sub(self.items_of(&acct, output));
        let made = inputs.iter().map(|i| self.items_of(&acct, *i)).min().unwrap_or(0).min(capacity).min(room);
        for i in inputs {
            self.burn_items(&acct, *i, made, "used in production");
        }
        self.mint_items(&acct, output, made, "produced");
    }

    fn collect_upkeep(&mut self, day: u32) {
        let treasury = env::current_account_id();
        let ids: Vec<String> = self.shops.keys().cloned().collect();
        for id in ids {
            let mut s = self.shop(&id);
            if !s.open {
                continue;
            }
            let acct = sub(&id);
            if self.coin_of(&acct) >= self.params.upkeep.0 {
                self.move_coin(&acct, &treasury, self.params.upkeep.0, "upkeep");
                s.missed_upkeep = 0;
            } else {
                s.missed_upkeep += 1;
                if s.missed_upkeep >= self.params.missed_upkeep_to_close {
                    s.open = false;
                    s.closed_day = Some(day);
                    self.shops.insert(id.clone(), s);
                    events::town("shop_closed", json!({ "shop": id, "day": day }));
                    // The holder forfeits the deed; the town auctions it to reopen the shop.
                    self.force_transfer_deed(&id, &treasury, "forfeited: shop closed");
                    self.open_auction(&id, AuctionKind::Bankruptcy);
                    continue;
                }
            }
            self.shops.insert(id, s);
        }
    }

    /// RULES.md §3: on a profitable day with cash above comfort, the deed holder gets the
    /// larger of half the day's profit or everything above the cash ceiling.
    fn pay_dividends(&mut self) {
        let ids: Vec<String> = self.shops.keys().cloned().collect();
        for id in ids {
            let mut s = self.shop(&id);
            let acct = sub(&id);
            let cash = self.coin_of(&acct);
            if s.open && cash > s.day_start_cash.0 && cash > self.params.cash_comfort.0 {
                let profit = cash - s.day_start_cash.0;
                let div = (profit * self.params.dividend_share_bps as u128 / 10_000)
                    .max(cash.saturating_sub(self.params.cash_ceiling.0))
                    .min(cash);
                let holder = self.deed_owner(&id);
                self.move_coin(&acct, &holder, div, "dividend");
                s.dividends_paid = U128(s.dividends_paid.0 + div);
                events::town("dividend", json!({ "shop": id, "holder": holder, "amount": U128(div) }));
            }
            s.day_start_cash = U128(self.coin_of(&acct));
            self.shops.insert(id, s);
        }
    }

    fn festival(&mut self, week: u32) {
        let p = &self.params;
        let (target, counted) = (self.week_target, self.week_counted);
        let hit = counted > 0 && counted >= target;
        let (mut minted, mut burned) = (0, 0);
        if hit {
            minted = self.coin.total_supply * p.festival_mint_bps as u128 / 10_000;
            self.mint_coin(&sub("festival"), minted, "festival");
            self.streak += 1;
            self.best_streak = self.best_streak.max(self.streak);
        } else {
            let treasury = env::current_account_id();
            burned = self.coin_of(&treasury) * p.miss_burn_bps as u128 / 10_000;
            self.burn_coin(&treasury, burned, "missed festival");
            self.streak = 0;
        }
        self.weeks.push(WeekResult {
            week,
            target: U128(target),
            counted: U128(counted),
            hit,
            minted: U128(minted),
            burned: U128(burned),
            streak: self.streak,
        });

        let n = self.weeks.len();
        let recent: Vec<u128> = (n.saturating_sub(2)..n).filter_map(|i| self.weeks.get(i)).map(|w| w.counted.0).collect();
        let mean = recent.iter().sum::<u128>() / recent.len() as u128;
        self.week_target = (mean * self.params.target_growth_bps as u128 / 10_000).max(self.params.target_floor.0);
        self.week_counted = 0;
        events::town("festival", json!({
            "week": week, "hit": hit, "target": U128(target), "counted": U128(counted),
            "minted": U128(minted), "burned": U128(burned), "streak": self.streak,
            "next_target": U128(self.week_target),
        }));
    }

    /// A player's share of a finished week's festival pool: pool × their counted volume / all counted.
    pub(crate) fn claimable(&self, pw: &PlayerWeek) -> u128 {
        let Some(w) = self.weeks.get(pw.week) else { return 0 };
        if !w.hit || w.counted.0 == 0 {
            return 0;
        }
        w.minted.0 * self.contribution(pw.volume.0) / w.counted.0
    }

    pub(crate) fn pay_claim(&mut self, player: &AccountId, pw: &PlayerWeek) -> u128 {
        let amount = self.claimable(pw);
        self.move_coin(&sub("festival"), player, amount, "festival share");
        amount
    }
}
