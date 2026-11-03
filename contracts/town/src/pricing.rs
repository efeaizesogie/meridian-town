//! RULES.md §2, in integer micro-MERI. Mirrors packages/economy/src/pricing.ts;
//! tests/fixtures/prices.json pins the two together.

use crate::params::Params;

/// ask = base × (2T / (S + T))²
pub fn ask(base: u128, stock: u64, target: u64) -> u128 {
    if target == 0 {
        return 0;
    }
    let t = target as u128;
    let d = stock as u128 + t;
    base * 4 * t * t / (d * d)
}

/// What a shop pays for one more unit, or 0 if it won't buy.
pub fn bid(p: &Params, base: u128, stock: u64, target: u64, cash: u128) -> u128 {
    if target == 0 || stock >= target * p.max_stock_mult as u64 {
        return 0;
    }
    let comfort = p.cash_comfort.0;
    let floor = comfort * p.min_cash_factor_bps as u128 / 10_000;
    let effective = cash.clamp(floor, comfort);
    let b = ask(base, stock + 1, target) * (10_000 - p.spread_bps as u128) / 10_000 * effective / comfort;
    if b <= cash {
        b
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::{Item, Params};

    #[test]
    fn multiplier_shape() {
        assert_eq!(ask(1_000_000, 0, 100), 4_000_000);
        assert_eq!(ask(1_000_000, 100, 100), 1_000_000);
        assert_eq!(ask(1_000_000, 300, 100), 250_000);
    }

    #[test]
    fn matches_typescript_engine() {
        let p = Params::default();
        let fx: serde_json::Value = serde_json::from_str(include_str!("../tests/fixtures/prices.json")).unwrap();
        let mut checked = 0;
        for c in fx["cases"].as_array().unwrap() {
            let item: Item = serde_json::from_value(c["item"].clone()).unwrap();
            let (stock, target) = (c["stock"].as_u64().unwrap(), c["target"].as_u64().unwrap());
            let cash = c["cash"].as_u64().unwrap() as u128;
            let base = p.base(item);
            let (a, b) = (ask(base, stock, target), bid(&p, base, stock, target, cash));
            let (ta, tb) = (c["ask"].as_u64().unwrap() as i128, c["bid"].as_u64().unwrap() as i128);
            // TS uses floats; allow 2 micro-MERI of rounding.
            assert!((a as i128 - ta).abs() <= 2, "ask {c}: rust {a} ts {ta}");
            assert!((b as i128 - tb).abs() <= 2, "bid {c}: rust {b} ts {tb}");
            checked += 1;
        }
        assert!(checked > 500);
    }
}
