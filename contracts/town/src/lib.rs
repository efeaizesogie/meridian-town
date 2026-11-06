//! Meridian Town: the coin (NEP-141), the goods (NEP-245), the shops and the market rules
//! in one contract, so a trade moves coin and goods atomically.
//!
//! Every balance is a real token balance: a shop's cash is the MERI held by
//! `<shop>.<town>`, its stock is the goods held by that account. The town treasury is
//! the contract account itself. See docs/RULES.md for the rules this enforces.

use near_contract_standards::fungible_token::events::{FtBurn, FtMint};
use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::non_fungible_token::NonFungibleToken;
use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, IterableSet, LookupMap, Vector};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

mod caravan;
mod days;
mod deeds;
mod events;
mod ft;
mod jobs;
mod market;
mod migrate;
mod mt;
pub mod params;
pub mod pricing;
#[cfg(test)]
mod tests;

use caravan::Round;
use deeds::Auction;
use params::{Item, Params};

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
pub(crate) enum Key {
    Coin,
    Items,
    Shops,
    Jobs,
    PlayerWeeks,
    Weeks,
    DeedOwners,
    DeedMeta,
    DeedEnum,
    Auctions,
    // Added in V3 (caravan, guilds). Append only: stored prefixes come from this order.
    CaravanRounds,
    CaravanCommits,
    Guilds,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Shop {
    pub id: String,
    pub name: String,
    pub buys: Vec<Item>,
    pub sells: Vec<Item>,
    /// Target stock per item (0 = not traded). Agents move it within a band of genesis.
    pub target: [u64; 5],
    pub genesis_target: [u64; 5],
    pub open: bool,
    pub missed_upkeep: u32,
    /// Agent account allowed to run the shop's strategy (targets, delivery contracts).
    /// Appointed by the deed holder; cleared whenever the deed changes hands.
    pub agent: Option<AccountId>,
    /// Market day the shop closed, while it is closed.
    pub closed_day: Option<u32>,
    /// Cash at the start of the current market day, to measure the day's profit.
    pub day_start_cash: U128,
    pub dividends_paid: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct Ground {
    /// Units available × 1e6, so slow regrowth isn't lost to rounding.
    pub micro_units: U128,
    pub updated_ns: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Job {
    pub id: u64,
    pub shop_id: String,
    pub item: Item,
    pub remaining: u64,
    pub unit_price: U128,
    pub deadline_ns: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct PlayerWeek {
    pub week: u32,
    pub volume: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct WeekResult {
    pub week: u32,
    pub target: U128,
    pub counted: U128,
    pub hit: bool,
    /// MERI minted into the festival pool (hit) or burned from the treasury (miss).
    pub minted: U128,
    pub burned: U128,
    pub streak: u32,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Town {
    pub(crate) owner: AccountId,
    pub(crate) minter: AccountId,
    pub(crate) params: Params,
    pub(crate) genesis_ns: u64,

    pub(crate) coin: FungibleToken,
    pub(crate) items: LookupMap<(AccountId, Item), u64>,
    pub(crate) item_supply: [u64; 5],

    pub(crate) shops: IterableMap<String, Shop>,
    pub(crate) grounds: [Ground; 3],
    pub(crate) jobs: IterableMap<u64, Job>,
    pub(crate) next_job_id: u64,

    /// Days fully processed (upkeep, production, festival).
    pub(crate) processed_days: u32,
    pub(crate) week_target: u128,
    pub(crate) week_counted: u128,
    pub(crate) streak: u32,
    pub(crate) best_streak: u32,
    pub(crate) player_weeks: LookupMap<AccountId, PlayerWeek>,
    pub(crate) weeks: Vector<WeekResult>,

    pub(crate) deeds: NonFungibleToken,
    pub(crate) auctions: IterableMap<String, Auction>,

    // V3: see migrate.rs
    pub(crate) caravan_rounds: LookupMap<u32, Round>,
    pub(crate) caravan_commits: LookupMap<(u32, Item, AccountId), Vec<u8>>,
    pub(crate) guilds: IterableSet<AccountId>,
}

pub(crate) fn sub(name: &str) -> AccountId {
    format!("{name}.{}", env::current_account_id()).parse().unwrap()
}

fn shop(id: &str, name: &str, buys: &[Item], sells: &[Item], targets: &[(Item, u64)]) -> Shop {
    let mut target = [0u64; 5];
    for (i, t) in targets {
        target[i.idx()] = *t;
    }
    Shop {
        id: id.into(),
        name: name.into(),
        buys: buys.to_vec(),
        sells: sells.to_vec(),
        target,
        genesis_target: target,
        open: true,
        missed_upkeep: 0,
        agent: None,
        closed_day: None,
        day_start_cash: U128(0),
        dividends_paid: U128(0),
    }
}

#[near]
impl Town {
    /// Genesis. `params` defaults to the simulator's DEFAULT_PARAMS; `day_ms` lets a demo
    /// town run fast without touching anything else.
    #[init]
    pub fn new(owner: AccountId, minter: AccountId, params: Option<Params>, day_ms: Option<u64>) -> Self {
        let mut params = params.unwrap_or_default();
        if let Some(d) = day_ms {
            params.day_ms = d;
        }
        require!(params.day_ms >= 60_000, "a day must be at least a minute");
        let now = env::block_timestamp();
        let mut town = Self {
            deeds: NonFungibleToken::new(Key::DeedOwners, env::current_account_id(), Some(Key::DeedMeta), Some(Key::DeedEnum), Option::<Key>::None),
            auctions: IterableMap::new(Key::Auctions),
            caravan_rounds: LookupMap::new(Key::CaravanRounds),
            caravan_commits: LookupMap::new(Key::CaravanCommits),
            guilds: IterableSet::new(Key::Guilds),
            owner,
            minter,
            genesis_ns: now,
            coin: FungibleToken::new(Key::Coin),
            items: LookupMap::new(Key::Items),
            item_supply: [0; 5],
            shops: IterableMap::new(Key::Shops),
            grounds: Default::default(),
            jobs: IterableMap::new(Key::Jobs),
            next_job_id: 1,
            processed_days: 0,
            week_target: params.target_floor.0,
            week_counted: 0,
            streak: 0,
            best_streak: 0,
            player_weeks: LookupMap::new(Key::PlayerWeeks),
            weeks: Vector::new(Key::Weeks),
            params,
        };

        use Item::*;
        let shops = [
            shop("lumberyard", "Brann's Lumberyard", &[Wood], &[Wood], &[(Wood, 120)]),
            shop("mine", "Petra's Mine Office", &[Ore], &[Ore], &[(Ore, 100)]),
            shop("granary", "Wen's Granary", &[Wheat], &[Wheat], &[(Wheat, 150)]),
            shop("smith", "Hilde's Forge", &[Wood, Ore], &[Tool], &[(Wood, 30), (Ore, 30), (Tool, 20)]),
            shop("baker", "Oswin's Bakery", &[Wheat], &[Bread], &[(Wheat, 60), (Bread, 60)]),
            shop("store", "Mabel's General Store", &[Bread, Tool], &[Bread, Tool], &[(Bread, 40), (Tool, 10)]),
        ];

        let treasury = env::current_account_id();
        town.mint_coin(&treasury, town.params.genesis_treasury.0, "genesis treasury");
        let outside = sub("outside");
        town.mint_coin(&outside, town.params.outside_start.0, "genesis outside traders");
        for mut s in shops {
            let acct = sub(&s.id);
            town.mint_coin(&acct, town.params.genesis_shop_cash.0, "genesis shop cash");
            s.day_start_cash = town.params.genesis_shop_cash;
            town.mint_deed(&s);
            for item in Item::ALL {
                town.mint_items(&acct, item, s.target[item.idx()], "genesis stock");
            }
            town.shops.insert(s.id.clone(), s);
        }
        for i in 0..3 {
            town.grounds[i] = Ground { micro_units: U128(town.ground_capacity(i)), updated_ns: now };
        }
        town
    }

    // ---------- admin: the operator can rotate keys, never rules ----------

    pub fn set_minter(&mut self, minter: AccountId) {
        self.assert_owner();
        self.minter = minter;
    }

    /// The one rule the operator may tune: the Festival's weekly target floor, so a small town
    /// can reach it. Bounded to 100–1,000 MERI and logged, so players can see every change.
    pub fn set_target_floor(&mut self, floor: U128) {
        self.assert_owner();
        let m = params::MICRO;
        require!(floor.0 >= 100 * m && floor.0 <= 1_000 * m, "the floor must be 100 to 1,000 MERI");
        let old = self.params.target_floor.0;
        self.params.target_floor = floor;
        // A week whose target was only the old floor now aims at the new one.
        if self.week_target == old {
            self.week_target = floor.0;
        }
        events::town("target_floor_set", near_sdk::serde_json::json!({ "from": U128(old), "to": floor, "week_target": U128(self.week_target) }));
    }

    pub fn get_params(&self) -> Params {
        self.params.clone()
    }

    pub fn get_roles(&self) -> (AccountId, AccountId) {
        (self.owner.clone(), self.minter.clone())
    }
}

impl Town {
    pub(crate) fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    pub(crate) fn shop(&self, id: &str) -> Shop {
        self.shops.get(id).cloned().unwrap_or_else(|| env::panic_str("no such shop"))
    }

    pub(crate) fn coin_of(&self, account: &AccountId) -> u128 {
        self.coin.accounts.get(account).unwrap_or(0)
    }

    fn ensure_registered(&mut self, account: &AccountId) {
        if !self.coin.accounts.contains_key(account) {
            self.coin.internal_register_account(account);
        }
    }

    pub(crate) fn mint_coin(&mut self, to: &AccountId, amount: u128, memo: &str) {
        if amount == 0 {
            return;
        }
        self.ensure_registered(to);
        self.coin.internal_deposit(to, amount);
        FtMint { owner_id: to, amount: U128(amount), memo: Some(memo) }.emit();
    }

    pub(crate) fn burn_coin(&mut self, from: &AccountId, amount: u128, memo: &str) {
        if amount == 0 {
            return;
        }
        self.coin.internal_withdraw(from, amount);
        FtBurn { owner_id: from, amount: U128(amount), memo: Some(memo) }.emit();
    }

    pub(crate) fn move_coin(&mut self, from: &AccountId, to: &AccountId, amount: u128, memo: &str) {
        if amount == 0 || from == to {
            return;
        }
        self.ensure_registered(to);
        self.coin.internal_transfer(from, to, amount, Some(memo.to_string()));
    }

    pub(crate) fn ground_capacity(&self, i: usize) -> u128 {
        self.params.ground_regen_per_day[i] as u128 * self.params.ground_capacity_days as u128 * params::MICRO
    }
}
