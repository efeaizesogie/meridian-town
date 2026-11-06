use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken};

use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;

use crate::deeds::AuctionKind;
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
    let mut known: Vec<AccountId> = vec![town_id(), sub("outside"), sub("escrow"), sub("festival"), sub("auction")];
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
    // The keeper catches up a few days per call; a week takes several calls.
    while t.processed_days < 7 {
        as_("keeper.testnet", T0 + 7 * DAY_NS + 1);
        t.advance();
    }
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

#[test]
fn using_bread_burns_it() {
    let mut t = genesis();
    as_("server.testnet", T0);
    t.gather(acc("ada.testnet"), Item::Wheat, 40);
    as_("ada.testnet", T0 + 1);
    t.sell("granary".into(), Item::Wheat, 40, U128(0));
    let cost = t.quote_buy("baker".into(), Item::Bread, 2).0;
    t.buy("baker".into(), Item::Bread, 2, U128(cost));
    t.use_item(Item::Bread, 2);
    assert_eq!(t.items_of(&acc("ada.testnet"), Item::Bread), 0);
}

#[test]
#[should_panic(expected = "only bread and tools can be used")]
fn raw_goods_cant_be_used() {
    let mut t = genesis();
    as_("ada.testnet", T0 + 1);
    t.use_item(Item::Ore, 1);
}

// ---------- deeds ----------

/// Give a player coins from the outside traders (test setup only).
fn fund(t: &mut Town, who: &str, meri: u128) {
    t.move_coin(&sub("outside"), &acc(who), meri * MICRO, "test funding");
}

/// Run the clock to the end of market day `day` (0-based).
fn run_to_day(t: &mut Town, day: u64) {
    as_("keeper.testnet", T0 + (day + 1) * DAY_NS + 1);
    t.advance();
}

/// Sell a town-held deed to `who` through a town sale auction ending on `end_day`.
fn buy_deed(t: &mut Town, shop: &str, who: &str, meri: u128, end_day: u64) {
    as_("owner.testnet", T0 + (end_day - 1) * DAY_NS + 10);
    t.auction_deed(shop.into());
    as_(who, T0 + (end_day - 1) * DAY_NS + 20);
    t.bid_for_deed(shop.into(), U128(meri * MICRO));
    run_to_day(t, end_day);
    assert_eq!(t.deed_owner(shop), acc(who));
}

#[test]
fn genesis_mints_six_deeds_to_the_town() {
    let t = genesis();
    assert_eq!(t.nft_total_supply(), U128(6));
    assert_eq!(t.nft_supply_for_owner(town_id()), U128(6));
    let deed = t.nft_token("smith".into()).unwrap();
    let m = deed.metadata.unwrap();
    assert_eq!(m.title.unwrap(), "Deed: Hilde's Forge");
    assert!(m.extra.unwrap().contains(r#""cash":"1500000000""#), "live cash in the token");
    assert!(m.media.unwrap().starts_with("data:image/svg+xml"));
}

#[test]
fn the_town_sells_a_deed_to_the_highest_bidder() {
    let mut t = genesis();
    fund(&mut t, "ada.testnet", 1_000);
    fund(&mut t, "bob.testnet", 1_000);
    as_("owner.testnet", T0 + 10);
    t.auction_deed("store".into());

    as_("ada.testnet", T0 + 20);
    t.bid_for_deed("store".into(), U128(300 * MICRO));
    as_("bob.testnet", T0 + 30);
    t.bid_for_deed("store".into(), U128(320 * MICRO));
    assert_eq!(t.coin_of(&acc("ada.testnet")), 1_000 * MICRO, "outbid bidder refunded at once");
    assert_eq!(t.coin_of(&sub("auction")), 320 * MICRO);

    let treasury = t.coin_of(&town_id());
    run_to_day(&mut t, 1);
    assert_eq!(t.deed_owner("store"), acc("bob.testnet"));
    assert!(t.coin_of(&town_id()) >= treasury + 320 * MICRO, "sale proceeds go to the treasury");
    assert!(t.get_auctions().is_empty());
    assert!(t.shop("store").open);
    assert_conserved(&t, &["ada.testnet", "bob.testnet"]);
}

#[test]
#[should_panic(expected = "bid must be at least")]
fn bids_must_beat_the_last_by_five_percent() {
    let mut t = genesis();
    fund(&mut t, "ada.testnet", 1_000);
    fund(&mut t, "bob.testnet", 1_000);
    as_("owner.testnet", T0 + 10);
    t.auction_deed("store".into());
    as_("ada.testnet", T0 + 20);
    t.bid_for_deed("store".into(), U128(300 * MICRO));
    as_("bob.testnet", T0 + 30);
    t.bid_for_deed("store".into(), U128(314 * MICRO));
}

#[test]
fn a_bankrupt_shop_is_forfeited_auctioned_and_reopened_by_the_winner() {
    let mut t = genesis();
    fund(&mut t, "bob.testnet", 1_000);
    fund(&mut t, "cy.testnet", 1_000);
    buy_deed(&mut t, "store", "bob.testnet", 300, 1);
    as_("bob.testnet", T0 + DAY_NS * 2 + 5);
    t.set_agent("store".into(), Some(acc("mabel.agent.testnet")));

    // Drain the till: two missed upkeeps close the shop.
    let cash = t.coin_of(&sub("store"));
    t.move_coin(&sub("store"), &sub("outside"), cash - 10 * MICRO, "test drain");
    run_to_day(&mut t, 3);
    assert!(!t.shop("store").open);
    assert_eq!(t.deed_owner("store"), town_id(), "deed forfeited");
    assert_eq!(t.shop("store").agent, None, "old agent loses control");
    assert_eq!(t.get_auctions()[0].kind, AuctionKind::Bankruptcy);

    as_("cy.testnet", T0 + DAY_NS * 4 + 5);
    t.bid_for_deed("store".into(), U128(400 * MICRO));
    run_to_day(&mut t, 4);
    assert_eq!(t.deed_owner("store"), acc("cy.testnet"));
    assert!(t.shop("store").open);
    assert_eq!(t.coin_of(&sub("store")), (410 - 25) * MICRO, "the winning bid recapitalises the till, less that day's upkeep");
    assert_conserved(&t, &["bob.testnet", "cy.testnet"]);
}

#[test]
fn nobody_bids_so_the_town_rescues_the_shop() {
    let mut t = genesis();
    let cash = t.coin_of(&sub("store"));
    t.move_coin(&sub("store"), &sub("outside"), cash, "test drain");
    run_to_day(&mut t, 1);
    assert!(!t.shop("store").open);
    run_to_day(&mut t, 2);
    assert!(!t.shop("store").open, "still waiting for bids");
    run_to_day(&mut t, 3);
    assert!(t.shop("store").open);
    assert_eq!(t.coin_of(&sub("store")), (600 - 25) * MICRO, "2 x reserve, less that day's upkeep");
    assert_eq!(t.deed_owner("store"), town_id());
    assert_conserved(&t, &[]);
}

#[test]
fn dividends_go_to_whoever_holds_the_deed() {
    let mut t = genesis();
    fund(&mut t, "bob.testnet", 1_000);
    buy_deed(&mut t, "smith", "bob.testnet", 300, 1);
    let bob = t.coin_of(&acc("bob.testnet"));
    // A windfall day for the smith: 5,000 MERI on top of its start-of-day cash.
    t.move_coin(&sub("outside"), &sub("smith"), 5_000 * MICRO, "test windfall");
    run_to_day(&mut t, 2);
    let paid = t.coin_of(&acc("bob.testnet")) - bob;
    assert!(paid > 0);
    let after = t.coin_of(&sub("smith"));
    assert!(after <= 2_000 * MICRO, "everything above the 2,000 ceiling is paid out (till {after})");
    assert_eq!(t.shop("smith").dividends_paid.0, paid);
    assert_conserved(&t, &["bob.testnet"]);
}

#[test]
fn transferring_a_deed_hands_over_control() {
    let mut t = genesis();
    fund(&mut t, "bob.testnet", 1_000);
    buy_deed(&mut t, "smith", "bob.testnet", 300, 1);
    as_("bob.testnet", T0 + DAY_NS * 2 + 5);
    t.set_agent("smith".into(), Some(acc("hilde.agent.testnet")));
    t.nft_transfer(acc("cy.testnet"), "smith".into(), None, None);
    assert_eq!(t.deed_owner("smith"), acc("cy.testnet"));
    assert_eq!(t.shop("smith").agent, None, "the old holder's agent is out");
    as_("cy.testnet", T0 + DAY_NS * 2 + 6);
    t.set_agent("smith".into(), Some(acc("cy.agent.testnet")));
    assert_eq!(t.shop("smith").agent, Some(acc("cy.agent.testnet")));
}

#[test]
#[should_panic(expected = "only the deed holder appoints the agent")]
fn the_old_holder_cant_appoint_agents() {
    let mut t = genesis();
    fund(&mut t, "bob.testnet", 1_000);
    buy_deed(&mut t, "smith", "bob.testnet", 300, 1);
    as_("bob.testnet", T0 + DAY_NS * 2 + 5);
    t.nft_transfer(acc("cy.testnet"), "smith".into(), None, None);
    t.set_agent("smith".into(), Some(acc("bob.agent.testnet")));
}

#[test]
#[should_panic(expected = "only the deed holder appoints the agent")]
fn the_operator_cant_take_over_a_players_shop() {
    let mut t = genesis();
    fund(&mut t, "bob.testnet", 1_000);
    buy_deed(&mut t, "smith", "bob.testnet", 300, 1);
    as_("owner.testnet", T0 + DAY_NS * 2 + 5);
    t.set_agent("smith".into(), Some(acc("owner.testnet")));
}

#[test]
#[should_panic(expected = "this deed is at auction")]
fn deeds_at_auction_cant_be_transferred() {
    let mut t = genesis();
    as_("owner.testnet", T0 + 10);
    t.auction_deed("store".into());
    as_("town.testnet", T0 + 11);
    t.nft_transfer(acc("cy.testnet"), "store".into(), None, None);
}

// ---------- caravan ----------

fn seal(day: u32, item: &str, price: u128, salt: &str, supplier: &str) -> String {
    let h = near_sdk::env::sha256(format!("{day}:{item}:{price}:{salt}:{supplier}").as_bytes());
    h.iter().map(|b| format!("{b:02x}")).collect()
}

/// The forge runs out of ore on day 0, so day 1's caravan carries an order for it.
fn caravan_day_one() -> Town {
    let mut t = genesis();
    let ore = t.items_of(&sub("smith"), Item::Ore);
    t.burn_items(&sub("smith"), Item::Ore, ore - 5, "test");
    // Keep the forge from turning the leftover ore into tools overnight.
    let wood = t.items_of(&sub("smith"), Item::Wood);
    t.burn_items(&sub("smith"), Item::Wood, wood, "test");
    run_to_day(&mut t, 0);
    t
}

#[test]
fn the_lowest_sealed_bid_fills_the_order() {
    let mut t = caravan_day_one();
    let view = t.get_caravan();
    let order = view.round.as_ref().unwrap().orders.iter().find(|o| o.shop_id == "smith" && o.item == Item::Ore).cloned().unwrap();
    assert_eq!(order.quantity, 25);
    assert_eq!(view.phase, "commit");

    let (a, b) = (7 * MICRO, 8 * MICRO);
    as_("ann.trader.testnet", T0 + DAY_NS + 10);
    t.caravan_commit(Item::Ore, seal(1, "ore", a, "s1", "ann.trader.testnet"));
    as_("bo.trader.testnet", T0 + DAY_NS + 20);
    t.caravan_commit(Item::Ore, seal(1, "ore", b, "s2", "bo.trader.testnet"));
    assert_eq!(t.get_caravan().round.unwrap().commits, [0, 2, 0]);
    assert!(t.get_caravan().round.unwrap().bids.is_empty(), "prices stay hidden until revealed");

    as_("ann.trader.testnet", T0 + DAY_NS + DAY_NS / 2 + 10);
    t.caravan_reveal(Item::Ore, U128(a), "s1".into());
    as_("bo.trader.testnet", T0 + DAY_NS + DAY_NS / 2 + 20);
    t.caravan_reveal(Item::Ore, U128(b), "s2".into());

    let smith_cash = t.coin_of(&sub("smith"));
    let outside = t.coin_of(&sub("outside"));
    run_to_day(&mut t, 1);
    let last = t.get_caravan().last.unwrap();
    assert!(last.settled);
    let fill = last.fills.iter().find(|f| f.shop_id == "smith").unwrap();
    assert_eq!((fill.quantity, fill.price.0, fill.supplier.as_str()), (25, a, "ann.trader.testnet"));
    let cost = 6 * MICRO * 11 / 10;
    assert_eq!(t.coin_of(&acc("ann.trader.testnet")), (a - cost) * 25, "supplier keeps price minus import cost");
    assert_eq!(t.coin_of(&sub("outside")) - outside, cost * 25);
    assert!(t.coin_of(&sub("smith")) < smith_cash - a * 25 + MICRO, "the smith paid for the ore (and upkeep)");
    assert_eq!(t.items_of(&sub("smith"), Item::Ore), 30);
    assert_conserved(&t, &["ann.trader.testnet", "bo.trader.testnet"]);
}

#[test]
#[should_panic(expected = "that isn't the bid you sealed")]
fn a_reveal_must_match_the_seal() {
    let mut t = caravan_day_one();
    as_("ann.trader.testnet", T0 + DAY_NS + 10);
    t.caravan_commit(Item::Ore, seal(1, "ore", 7 * MICRO, "s1", "ann.trader.testnet"));
    as_("ann.trader.testnet", T0 + DAY_NS + DAY_NS / 2 + 10);
    t.caravan_reveal(Item::Ore, U128(6_900_000), "s1".into());
}

#[test]
#[should_panic(expected = "bids are sealed in the first half of the day")]
fn no_sealing_after_the_window() {
    let mut t = caravan_day_one();
    as_("ann.trader.testnet", T0 + DAY_NS + DAY_NS / 2 + 10);
    t.caravan_commit(Item::Ore, seal(1, "ore", 7 * MICRO, "s1", "ann.trader.testnet"));
}

#[test]
#[should_panic(expected = "a bid can't be below the import cost")]
fn no_bids_below_import_cost() {
    let mut t = caravan_day_one();
    as_("ann.trader.testnet", T0 + DAY_NS + 10);
    t.caravan_commit(Item::Ore, seal(1, "ore", 6 * MICRO, "s1", "ann.trader.testnet"));
    as_("ann.trader.testnet", T0 + DAY_NS + DAY_NS / 2 + 10);
    t.caravan_reveal(Item::Ore, U128(6 * MICRO), "s1".into());
}

// ---------- guilds ----------

#[test]
fn guilds_collect_and_share_out() {
    let mut t = genesis();
    fund(&mut t, "ada.testnet", 100);
    as_("owner.testnet", T0 + 1);
    t.register_guild(acc("hammer.dao.testnet"));
    as_("ada.testnet", T0 + 2);
    t.pay_guild(acc("hammer.dao.testnet"), U128(60 * MICRO));
    assert_eq!(t.coin_of(&acc("hammer.dao.testnet")), 60 * MICRO);
    as_("hammer.dao.testnet", T0 + 3);
    t.share_out(vec![(acc("ada.testnet"), U128(20 * MICRO)), (acc("bob.testnet"), U128(30 * MICRO))]);
    assert_eq!(t.coin_of(&acc("bob.testnet")), 30 * MICRO);
    assert_eq!(t.coin_of(&acc("hammer.dao.testnet")), 10 * MICRO);
    assert_conserved(&t, &["ada.testnet", "bob.testnet", "hammer.dao.testnet"]);
}

#[test]
#[should_panic(expected = "only a registered guild can share out")]
fn only_guilds_share_out() {
    let mut t = genesis();
    fund(&mut t, "ada.testnet", 100);
    as_("ada.testnet", T0 + 2);
    t.share_out(vec![(acc("bob.testnet"), U128(20 * MICRO))]);
}

/// NEAR rejects any single log over 16 KiB, which reverts the whole call: a town left alone
/// for weeks must still catch up.
#[test]
fn every_log_fits_through_weeks_of_idle_days() {
    let mut t = genesis();
    let mut worst = (0usize, String::new());
    for day in 0..60u64 {
        run_to_day(&mut t, day);
        for l in near_sdk::test_utils::get_logs() {
            if l.len() > worst.0 {
                worst = (l.len(), l.chars().take(160).collect());
            }
        }
    }
    assert!(worst.0 < 16_384, "log of {} bytes: {}", worst.0, worst.1);
}

/// NEAR caps the *total* log output of one call at 16 KiB. A town that fell weeks behind must
/// catch up in calls that each stay under it, or `advance` reverts forever.
#[test]
fn catching_up_a_long_backlog_stays_under_the_log_budget() {
    let mut t = genesis();
    let mut calls = 0;
    while t.processed_days < 200 {
        // A fresh context per call: the mock, like the chain, counts logs per call.
        as_("keeper.testnet", T0 + 200 * DAY_NS + 1);
        t.advance();
        let total: usize = near_sdk::test_utils::get_logs().iter().map(|l| l.len()).sum();
        assert!(total < 16_384, "one advance logged {total} bytes");
        calls += 1;
        assert!(calls < 200, "advance made no progress");
    }
}

#[test]
fn the_owner_can_retire_a_guild() {
    let mut t = genesis();
    as_("owner.testnet", T0);
    t.register_guild(acc("old.sputnik.testnet"));
    t.register_guild(acc("new.sputnik.testnet"));
    t.unregister_guild(acc("old.sputnik.testnet"));
    assert_eq!(t.get_guilds(), vec![acc("new.sputnik.testnet")]);
}

#[test]
#[should_panic(expected = "owner")]
fn strangers_cant_retire_a_guild() {
    let mut t = genesis();
    as_("owner.testnet", T0);
    t.register_guild(acc("old.sputnik.testnet"));
    as_("mallory.testnet", T0);
    t.unregister_guild(acc("old.sputnik.testnet"));
}

#[test]
fn the_owner_can_lower_the_festival_floor_within_bounds() {
    let mut t = genesis();
    as_("owner.testnet", T0);
    let old = t.params.target_floor.0;
    assert_eq!(t.week_target, old);
    t.set_target_floor(U128(300 * MICRO));
    assert_eq!(t.params.target_floor.0, 300 * MICRO);
    assert_eq!(t.week_target, 300 * MICRO);
}

#[test]
#[should_panic(expected = "100 to 1,000")]
fn the_festival_floor_cant_be_set_out_of_bounds() {
    let mut t = genesis();
    as_("owner.testnet", T0);
    t.set_target_floor(U128(5 * MICRO));
}

#[test]
#[should_panic(expected = "owner")]
fn strangers_cant_move_the_festival_floor() {
    let mut t = genesis();
    as_("mallory.testnet", T0);
    t.set_target_floor(U128(300 * MICRO));
}
