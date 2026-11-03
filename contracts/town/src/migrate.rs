//! Upgrading a live town in place. Each struct here is the stored layout of an earlier
//! version; `migrate` reads it and adds the new collections without touching old data.

use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::non_fungible_token::NonFungibleToken;
use near_sdk::store::{IterableMap, IterableSet, LookupMap, Vector};
use near_sdk::{env, near, AccountId};

use crate::deeds::Auction;
use crate::params::{Item, Params};
use crate::{Ground, Job, Key, PlayerWeek, Shop, Town, TownExt, WeekResult};

/// Layout before the caravan and guilds (deployed 2026-11-03).
#[near(serializers = [borsh])]
pub struct TownV2 {
    owner: AccountId,
    minter: AccountId,
    params: Params,
    genesis_ns: u64,
    coin: FungibleToken,
    items: LookupMap<(AccountId, Item), u64>,
    item_supply: [u64; 5],
    shops: IterableMap<String, Shop>,
    grounds: [Ground; 3],
    jobs: IterableMap<u64, Job>,
    next_job_id: u64,
    processed_days: u32,
    week_target: u128,
    week_counted: u128,
    streak: u32,
    best_streak: u32,
    player_weeks: LookupMap<AccountId, PlayerWeek>,
    weeks: Vector<WeekResult>,
    deeds: NonFungibleToken,
    auctions: IterableMap<String, Auction>,
}

#[near]
impl Town {
    /// Run once, right after deploying this code over a V2 town.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: TownV2 = env::state_read().unwrap_or_else(|| env::panic_str("no town to migrate"));
        Self {
            owner: old.owner,
            minter: old.minter,
            params: old.params,
            genesis_ns: old.genesis_ns,
            coin: old.coin,
            items: old.items,
            item_supply: old.item_supply,
            shops: old.shops,
            grounds: old.grounds,
            jobs: old.jobs,
            next_job_id: old.next_job_id,
            processed_days: old.processed_days,
            week_target: old.week_target,
            week_counted: old.week_counted,
            streak: old.streak,
            best_streak: old.best_streak,
            player_weeks: old.player_weeks,
            weeks: old.weeks,
            deeds: old.deeds,
            auctions: old.auctions,
            caravan_rounds: LookupMap::new(Key::CaravanRounds),
            caravan_commits: LookupMap::new(Key::CaravanCommits),
            guilds: IterableSet::new(Key::Guilds),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    #[test]
    fn migrates_a_v2_town_without_losing_state() {
        testing_env!(VMContextBuilder::new().current_account_id("town.testnet".parse().unwrap()).predecessor_account_id("town.testnet".parse().unwrap()).build());
        // Build a real town, then write its V2 fields as the stored state.
        let t = Town::new("owner.testnet".parse().unwrap(), "server.testnet".parse().unwrap(), None, Some(60_000));
        let supply = t.coin.total_supply;
        let v2 = TownV2 {
            owner: t.owner, minter: t.minter, params: t.params, genesis_ns: t.genesis_ns, coin: t.coin, items: t.items,
            item_supply: t.item_supply, shops: t.shops, grounds: t.grounds, jobs: t.jobs, next_job_id: 7,
            processed_days: 12, week_target: t.week_target, week_counted: 5, streak: 1, best_streak: 2,
            player_weeks: t.player_weeks, weeks: t.weeks, deeds: t.deeds, auctions: t.auctions,
        };
        env::state_write(&v2);
        let m = Town::migrate();
        assert_eq!((m.next_job_id, m.processed_days, m.week_counted, m.best_streak), (7, 12, 5, 2));
        assert_eq!(m.coin.total_supply, supply);
        assert_eq!(m.shops.len(), 6);
        assert!(m.get_guilds().is_empty());
    }
}
