//! Launch parameters. Set once in `new`, never changed. Values mirror
//! packages/economy/src/params.ts (amounts here are micro-MERI, rates in basis points).

use near_sdk::json_types::U128;
use near_sdk::near;

pub const MICRO: u128 = 1_000_000;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Item {
    Wood,
    Ore,
    Wheat,
    Bread,
    Tool,
}

impl Item {
    pub const ALL: [Item; 5] = [Item::Wood, Item::Ore, Item::Wheat, Item::Bread, Item::Tool];
    pub const RAW: [Item; 3] = [Item::Wood, Item::Ore, Item::Wheat];

    pub fn idx(self) -> usize {
        self as usize
    }
    pub fn id(self) -> &'static str {
        ["wood", "ore", "wheat", "bread", "tool"][self.idx()]
    }
    pub fn from_id(id: &str) -> Option<Item> {
        Item::ALL.into_iter().find(|i| i.id() == id)
    }
    pub fn is_raw(self) -> bool {
        Item::RAW.contains(&self)
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Params {
    /// Length of a market day in milliseconds (a real day on mainnet; minutes for demos).
    pub day_ms: u64,
    pub days_per_week: u32,

    /// Reference price per item, micro-MERI, indexed by `Item`.
    pub base: [U128; 5],
    pub spread_bps: u32,
    pub max_stock_mult: u32,
    pub cash_comfort: U128,
    pub min_cash_factor_bps: u32,
    pub trade_tax_bps: u32,

    pub upkeep: U128,
    pub missed_upkeep_to_close: u32,
    pub auction_reserve: U128,
    /// Bids must beat the current high bid by this much.
    pub auction_min_raise_bps: u32,
    /// A bankrupt shop nobody bids for is recapitalised by the treasury (2 × reserve) after this many days.
    pub auction_rescue_days: u32,
    pub dividend_share_bps: u32,
    pub cash_ceiling: U128,

    /// Production per day: tools at the smith (1 wood + 1 ore each), bread at the baker (1 wheat).
    pub blacksmith_capacity: u64,
    pub baker_capacity: u64,

    /// Units regrown per day on each ground (wood, ore, wheat).
    pub ground_regen_per_day: [u64; 3],
    pub ground_capacity_days: u32,

    pub job_trigger_bps: u32,
    pub job_premium_bps: u32,
    pub job_max_hours: u32,
    /// Agents may move a shop's target stock within ± this share of its genesis target.
    pub agent_target_band_bps: u32,

    pub player_volume_cap: U128,
    pub min_qualifying_volume: U128,
    pub target_floor: U128,
    pub target_growth_bps: u32,
    pub festival_mint_bps: u32,
    pub miss_burn_bps: u32,

    pub genesis_treasury: U128,
    pub genesis_shop_cash: U128,
    pub outside_start: U128,
    pub starter_coins: U128,
}

impl Params {
    pub fn base(&self, item: Item) -> u128 {
        self.base[item.idx()].0
    }
    pub fn day_ns(&self) -> u64 {
        self.day_ms * 1_000_000
    }
}

impl Default for Params {
    fn default() -> Self {
        let m = MICRO;
        Self {
            day_ms: 24 * 60 * 60 * 1000,
            days_per_week: 7,
            base: [U128(4 * m), U128(6 * m), U128(3 * m), U128(8 * m), U128(24 * m)],
            spread_bps: 2_000,
            max_stock_mult: 3,
            cash_comfort: U128(600 * m),
            min_cash_factor_bps: 2_500,
            trade_tax_bps: 200,
            upkeep: U128(25 * m),
            missed_upkeep_to_close: 2,
            auction_reserve: U128(300 * m),
            auction_min_raise_bps: 500,
            auction_rescue_days: 3,
            dividend_share_bps: 5_000,
            cash_ceiling: U128(2_000 * m),
            blacksmith_capacity: 60,
            baker_capacity: 200,
            ground_regen_per_day: [45, 45, 115],
            ground_capacity_days: 1,
            job_trigger_bps: 3_000,
            job_premium_bps: 1_500,
            job_max_hours: 6,
            agent_target_band_bps: 3_000,
            player_volume_cap: U128(500 * m),
            min_qualifying_volume: U128(20 * m),
            target_floor: U128(1_000 * m),
            target_growth_bps: 9_500,
            festival_mint_bps: 100,
            miss_burn_bps: 500,
            genesis_treasury: U128(20_000 * m),
            genesis_shop_cash: U128(1_500 * m),
            outside_start: U128(30_000 * m),
            starter_coins: U128(50 * m),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The contract's defaults must equal the simulator's DEFAULT_PARAMS.
    #[test]
    fn defaults_match_simulator_fixture() {
        let fx: serde_json::Value = serde_json::from_str(include_str!("../tests/fixtures/prices.json")).unwrap();
        let p = Params::default();
        for item in Item::ALL {
            let ts = fx["base"][item.id()].as_f64().unwrap();
            assert_eq!(p.base(item), (ts * MICRO as f64) as u128, "{}", item.id());
        }
        assert_eq!(p.spread_bps as f64 / 10_000.0, fx["spread"].as_f64().unwrap());
        assert_eq!(p.max_stock_mult as u64, fx["maxStockMult"].as_u64().unwrap());
        assert_eq!(p.cash_comfort.0, fx["cashComfort"].as_u64().unwrap() as u128 * MICRO);
        assert_eq!(p.min_cash_factor_bps as f64 / 10_000.0, fx["minCashFactor"].as_f64().unwrap());
    }
}
