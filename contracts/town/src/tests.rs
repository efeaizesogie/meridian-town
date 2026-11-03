use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken};

use crate::params::{Item, MICRO};
use crate::{sub, Town};

const DAY_MS: u64 = 60_000;
const DAY_NS: u64 = DAY_MS * 1_000_000;
const T0: u64 = 1_700_000_000_000_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn town_id() -> AccountId {
    acc("town.testnet")
}

fn as_(who: &str, at_ns: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(town_id())
        .predecessor_account_id(acc(who))
        .signer_account_id(acc(who))
        .block_timestamp(at_ns)
        .attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(b.build());
}

fn genesis() -> Town {
    as_("owner.testnet", T0);
    Town::new(acc("owner.testnet"), acc("server.testnet"), None, Some(DAY_MS))
}

/// Every coin must sit in a known account: players, shops, treasury, outside, escrow, festival pool.
fn assert_conserved(t: &Town, players: &[&str]) {
    let mut known: Vec<AccountId> = vec![town_id(), sub("outside"), sub("escrow"), sub("festival")];
    known.extend(t.shops.keys().map(|id| sub(id)));
    known.extend(players.iter().map(|p| acc(p)));
    let sum: u128 = known.iter().map(|a| t.coin_of(a)).sum();
    assert_eq!(sum, t.coin.total_supply, "coins outside known accounts");
}

#[test]
fn genesis_supply_and_shops() {
    let t = genesis();
    assert_eq!(t.coin.total_supply, 59_000 * MICRO);
    assert_eq!(t.coin_of(&town_id()), 20_000 * MICRO);
    let shops = t.get_shops();
    assert_eq!(shops.len(), 6);
    let mine = shops.iter().find(|s| s.shop.id == "mine").unwrap();
    assert_eq!(mine.stock[Item::Ore.idx()], 100);
    assert_eq!(mine.ask[Item::Ore.idx()], U128(6 * MICRO), "at target, ask = reference price");
    assert_conserved(&t, &[]);
}

#[test]
fn gathering_is_capped_by_the_ground_and_regrows() {
    let mut t = genesis();
    as_("server.testnet", T0);
    assert_eq!(t.gather(acc("ada.testnet"), Item::Ore, 30), 30);
    assert_eq!(t.gather(acc("bob.testnet"), Item::Ore, 30), 15, "only 45 ore regrow per day");
    assert_eq!(t.gather(acc("bob.testnet"), Item::Ore, 30), 0);
    as_("server.testnet", T0 + DAY_NS / 3);
    assert_eq!(t.gather(acc("bob.testnet"), Item::Ore, 30), 15, "a third of a day regrows 15");
    assert_eq!(t.items_of(&acc("bob.testnet"), Item::Ore), 30);
}

#[test]
#[should_panic(expected = "minter only")]
fn only_the_game_server_can_gather() {
    let mut t = genesis();
    as_("ada.testnet", T0);
    t.gather(acc("ada.testnet"), Item::Ore, 5);
}

#[test]
fn selling_pays_the_falling_bid_minus_tax() {
    let mut t = genesis();
    as_("server.testnet", T0);
    t.gather(acc("ada.testnet"), Item::Ore, 10);

    as_("ada.testnet", T0 + 1);
    let quote = t.quote_sell("mine".into(), Item::Ore, 10).0;
    let treasury_before = t.coin_of(&town_id());
    let got = t.sell("mine".into(), Item::Ore, 10, U128(quote)).0;
    let tax = quote * 200 / 10_000;
    assert_eq!(got, quote - tax);
    assert_eq!(t.coin_of(&acc("ada.testnet")), got);
    assert_eq!(t.coin_of(&town_id()) - treasury_before, tax);
    assert_eq!(t.items_of(&sub("mine"), Item::Ore), 110);
    assert!(quote < 10 * 6 * MICRO * 8 / 10, "each unit sold pushes the bid down");
    assert_eq!(t.week_counted, quote, "counted toward the festival");
    assert_conserved(&t, &["ada.testnet"]);
}

#[test]
#[should_panic(expected = "price moved below min_total")]
fn selling_respects_slippage() {
    let mut t = genesis();
    as_("server.testnet", T0);
    t.gather(acc("ada.testnet"), Item::Ore, 10);
    as_("ada.testnet", T0 + 1);
    let quote = t.quote_sell("mine".into(), Item::Ore, 10).0;
    t.sell("mine".into(), Item::Ore, 10, U128(quote + 1));
}

#[test]
fn buying_pays_the_rising_ask_plus_tax() {
    let mut t = genesis();
    as_("server.testnet", T0);
    t.gather(acc("ada.testnet"), Item::Wheat, 40);
    as_("ada.testnet", T0 + 1);
    t.sell("granary".into(), Item::Wheat, 40, U128(0));
    let cash = t.coin_of(&acc("ada.testnet"));
    let cost = t.quote_buy("baker".into(), Item::Bread, 3).0;
    assert_eq!(t.buy("baker".into(), Item::Bread, 3, U128(cost)).0, cost);
    assert_eq!(t.coin_of(&acc("ada.testnet")), cash - cost);
    assert_eq!(t.items_of(&acc("ada.testnet"), Item::Bread), 3);
    assert_conserved(&t, &["ada.testnet"]);
}

/// Drain the smith's ore so it is allowed to post a contract.
fn smith_short_of_ore(t: &mut Town) {
    let ore = t.items_of(&sub("smith"), Item::Ore);
    t.burn_items(&sub("smith"), Item::Ore, ore - 5, "test");
    as_("owner.testnet", T0 + 1);
    t.set_agent("smith".into(), Some(acc("hilde.agent.testnet")));
}

#[test]
fn delivery_contract_escrows_pays_per_unit_and_refunds() {
    let mut t = genesis();
    smith_short_of_ore(&mut t);
    let smith_cash = t.coin_of(&sub("smith"));

    as_("hilde.agent.testnet", T0 + 2);
    let price = 7 * MICRO;
    let id = t.post_job("smith".into(), Item::Ore, 12, U128(price), 2);
    assert_eq!(t.coin_of(&sub("escrow")), 12 * price);
    assert_eq!(t.coin_of(&sub("smith")), smith_cash - 12 * price);

    as_("server.testnet", T0 + 3);
    t.gather(acc("ada.testnet"), Item::Ore, 5);
    as_("ada.testnet", T0 + 4);
    assert_eq!(t.deliver(id, 5).0, 5 * price);
    assert_eq!(t.items_of(&sub("smith"), Item::Ore), 10);
    assert_eq!(t.coin_of(&sub("escrow")), 7 * price);

    as_("anyone.testnet", T0 + 2 * 3_600_000_000_000 + 5);
    assert_eq!(t.expire_job(id).0, 7 * price);
    assert_eq!(t.coin_of(&sub("escrow")), 0);
    assert_eq!(t.coin_of(&sub("smith")), smith_cash - 5 * price);
    assert!(t.get_jobs().is_empty());
    assert_conserved(&t, &["ada.testnet"]);
}

#[test]
#[should_panic(expected = "unit price must be at most")]
fn agents_cant_overpay_from_the_shop() {
    let mut t = genesis();
    smith_short_of_ore(&mut t);
    as_("hilde.agent.testnet", T0 + 2);
    t.post_job("smith".into(), Item::Ore, 12, U128(100 * MICRO), 2);
}

#[test]
#[should_panic(expected = "only this shop's agent")]
fn strangers_cant_run_a_shop() {
    let mut t = genesis();
    smith_short_of_ore(&mut t);
    as_("mallory.testnet", T0 + 2);
    t.post_job("smith".into(), Item::Ore, 12, U128(5 * MICRO), 2);
}

#[test]
#[should_panic(expected = "target must be within")]
fn agents_move_targets_only_within_the_band() {
    let mut t = genesis();
    smith_short_of_ore(&mut t);
    as_("hilde.agent.testnet", T0 + 2);
    t.set_target("smith".into(), Item::Ore, 39); // genesis 30, band ±9
    t.set_target("smith".into(), Item::Ore, 40);
}

#[test]
fn festival_hit_mints_a_pool_players_claim() {
    let mut t = genesis();
    // Week 0: ada and bob trade past the 1,000 MERI floor between them.
    for (i, p) in ["ada.testnet", "bob.testnet", "cy.testnet"].iter().enumerate() {
        for d in 0..6u64 {
            let at = T0 + d * DAY_NS + i as u64 * 1_000;
            as_("server.testnet", at);
            for item in Item::RAW {
                t.gather(acc(p), item, 15);
            }
            as_(p, at + 1);
            for (shop, item) in [("granary", Item::Wheat), ("baker", Item::Wheat), ("mine", Item::Ore), ("smith", Item::Ore), ("lumberyard", Item::Wood), ("smith", Item::Wood)] {
                let n = (t.items_of(&acc(p), item) as u32).min(t.sell_capacity(shop.into(), item));
                if n > 0 {
                    t.sell(shop.into(), item, n, U128(0));
                }
            }
        }
    }
    let counted = t.week_counted;
    let supply_before = t.coin.total_supply;

    as_("keeper.testnet", T0 + 7 * DAY_NS + 1);
    t.advance();
    let w = t.get_weeks(None, None);
    assert_eq!(w.len(), 1);
    assert_eq!(w[0].counted.0, counted);
    assert!(counted >= 1_000 * MICRO, "test setup should beat the floor, counted {counted}");
    assert!(w[0].hit);
    assert_eq!(w[0].minted.0, supply_before / 100);
    as_("ada.testnet", T0 + 7 * DAY_NS + 2);
    let share = t.claim_festival().0;
    assert!(share > 0);
    as_("ada.testnet", T0 + 7 * DAY_NS + 3);
    assert_eq!(t.claim_festival().0, 0, "no double claims");
    assert_conserved(&t, &["ada.testnet", "bob.testnet", "cy.testnet"]);
}

#[test]
fn festival_miss_burns_treasury() {
    let mut t = genesis();
    let treasury = t.coin_of(&town_id());
    as_("keeper.testnet", T0 + 7 * DAY_NS + 1);
    t.advance();
    let w = &t.get_weeks(None, None)[0];
    assert!(!w.hit);
    // Upkeep arrives daily before the burn: 6 shops × 25 × 7 days.
    let before_burn = treasury + 6 * 25 * 7 * MICRO;
    assert_eq!(w.burned.0, before_burn * 500 / 10_000);
    assert_eq!(t.coin.total_supply, 59_000 * MICRO - w.burned.0);
    assert_conserved(&t, &[]);
}

#[test]
fn broke_shops_close_after_missed_upkeep() {
    let mut t = genesis();
    let cash = t.coin_of(&sub("store"));
    t.move_coin(&sub("store"), &acc("ada.testnet"), cash - 10 * MICRO, "test");
    as_("keeper.testnet", T0 + 2 * DAY_NS + 1);
    t.advance();
    assert!(!t.shop("store").open);
    assert!(t.shop("mine").open);
}

#[test]
fn production_turns_inputs_into_goods() {
    let mut t = genesis();
    as_("keeper.testnet", T0 + DAY_NS + 1);
    t.advance();
    // Smith holds 30 wood, 30 ore, 20 tools; room for 40 more tools; makes 30.
    assert_eq!(t.items_of(&sub("smith"), Item::Tool), 50);
    assert_eq!(t.items_of(&sub("smith"), Item::Wood), 0);
    assert_eq!(t.items_of(&sub("baker"), Item::Bread), 120);
}
