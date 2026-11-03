//! Shop deeds: one NEP-171 token per shop (token_id = shop id). Whoever holds the deed
//! appoints the shop's agent and collects its dividends (RULES.md §3). Deeds change
//! hands by transfer or at auction: a bankrupt shop's deed is forfeited to the town and
//! auctioned, and the town can sell the deeds it holds.

use std::collections::HashMap;

use near_contract_standards::non_fungible_token::core::{NonFungibleTokenCore, NonFungibleTokenResolver};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::{NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC};
use near_contract_standards::non_fungible_token::{Token, TokenId};
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId, PromiseOrValue};

use crate::params::Item;
use crate::{events, sub, Shop, Town, TownExt};

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AuctionKind {
    /// The shop went broke; the winning bid goes into its till and reopens it.
    Bankruptcy,
    /// The town sells a deed it holds; the winning bid goes to the treasury.
    Sale,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Auction {
    pub shop_id: String,
    pub kind: AuctionKind,
    pub opened_day: u32,
    /// Settles at the end of this market day.
    pub ends_day: u32,
    pub high_bidder: Option<AccountId>,
    pub high_bid: U128,
}

#[near]
impl Town {
    /// Owner: put a deed the town holds up for sale. The shop keeps trading meanwhile.
    pub fn auction_deed(&mut self, shop_id: String) {
        self.assert_owner();
        self.catch_up();
        require!(self.shop(&shop_id).open, "shop is closed");
        require!(self.deed_owner(&shop_id) == env::current_account_id(), "the town doesn't hold this deed");
        self.open_auction(&shop_id, AuctionKind::Sale);
    }

    /// Bid for a deed. The bid is held by the auction; an outbid bidder is refunded at once.
    pub fn bid_for_deed(&mut self, shop_id: String, amount: U128) {
        self.catch_up();
        let bidder = env::predecessor_account_id();
        let mut a = self.auctions.get(&shop_id).cloned().unwrap_or_else(|| env::panic_str("no auction for this deed"));
        let min = if a.high_bidder.is_some() {
            a.high_bid.0 * (10_000 + self.params.auction_min_raise_bps as u128) / 10_000
        } else {
            self.params.auction_reserve.0
        };
        require!(amount.0 >= min, format!("bid must be at least {min}"));
        self.move_coin(&bidder, &sub("auction"), amount.0, "deed bid");
        if let Some(prev) = a.high_bidder.take() {
            self.move_coin(&sub("auction"), &prev, a.high_bid.0, "outbid refund");
        }
        a.high_bidder = Some(bidder.clone());
        a.high_bid = amount;
        self.auctions.insert(shop_id.clone(), a);
        events::town("deed_bid", json!({ "shop": shop_id, "bidder": bidder, "amount": amount }));
    }

    /// Deed holder (or the owner, for town-held deeds): appoint the shop's agent.
    pub fn set_agent(&mut self, shop_id: String, agent: Option<AccountId>) {
        let caller = env::predecessor_account_id();
        let holder = self.deed_owner(&shop_id);
        require!(
            caller == holder || (holder == env::current_account_id() && caller == self.owner),
            "only the deed holder appoints the agent"
        );
        let mut s = self.shop(&shop_id);
        s.agent = agent.clone();
        self.shops.insert(shop_id.clone(), s);
        events::town("agent_set", json!({ "shop": shop_id, "agent": agent }));
    }

    pub fn get_auctions(&self) -> Vec<Auction> {
        self.auctions.values().cloned().collect()
    }
}

// ---------- NEP-171 ----------

#[near]
impl NonFungibleTokenCore for Town {
    #[payable]
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>) {
        self.before_deed_transfer(&token_id);
        self.deeds.nft_transfer(receiver_id, token_id, approval_id, memo)
    }

    #[payable]
    fn nft_transfer_call(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>, msg: String) -> PromiseOrValue<bool> {
        self.before_deed_transfer(&token_id);
        self.deeds.nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.deeds.nft_token(token_id).map(|t| self.decorate(t))
    }
}

#[near]
impl NonFungibleTokenResolver for Town {
    #[private]
    fn nft_resolve_transfer(&mut self, previous_owner_id: AccountId, receiver_id: AccountId, token_id: TokenId, approved_account_ids: Option<HashMap<AccountId, u64>>) -> bool {
        self.deeds.nft_resolve_transfer(previous_owner_id, receiver_id, token_id, approved_account_ids)
    }
}

#[near]
impl NonFungibleTokenEnumeration for Town {
    fn nft_total_supply(&self) -> U128 {
        self.deeds.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.deeds.nft_tokens(from_index, limit).into_iter().map(|t| self.decorate(t)).collect()
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.deeds.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.deeds.nft_tokens_for_owner(account_id, from_index, limit).into_iter().map(|t| self.decorate(t)).collect()
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Town {
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Meridian Town Deeds".to_string(),
            symbol: "DEED".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
}

impl Town {
    pub(crate) fn mint_deed(&mut self, s: &Shop) {
        let meta = TokenMetadata {
            title: Some(format!("Deed: {}", s.name)),
            description: Some(format!(
                "Ownership of {} in Meridian Town. The holder appoints the shop's agent and collects its dividends.",
                sub(&s.id)
            )),
            ..Default::default()
        };
        let town = env::current_account_id();
        self.deeds.internal_mint_with_refund(s.id.clone(), town.clone(), Some(meta), None);
        NftMint { owner_id: &town, token_ids: &[&s.id], memo: Some("genesis") }.emit();
    }

    pub(crate) fn deed_owner(&self, shop_id: &str) -> AccountId {
        self.deeds.owner_by_id.get(&shop_id.to_string()).unwrap_or_else(|| env::panic_str("no such deed"))
    }

    /// Move a deed without the holder's signature: forfeits and auction settlements only.
    pub(crate) fn force_transfer_deed(&mut self, shop_id: &str, to: &AccountId, memo: &str) {
        let from = self.deed_owner(shop_id);
        if &from == to {
            return;
        }
        self.deeds.internal_transfer(&from, to, &shop_id.to_string(), None, Some(memo.to_string()));
        self.clear_agent(shop_id);
    }

    fn before_deed_transfer(&mut self, shop_id: &str) {
        require!(self.shop(shop_id).open, "a closed shop's deed can't be transferred");
        require!(self.auctions.get(shop_id).is_none(), "this deed is at auction");
        // The new holder appoints their own agent.
        self.clear_agent(shop_id);
    }

    fn clear_agent(&mut self, shop_id: &str) {
        let mut s = self.shop(shop_id);
        if s.agent.take().is_some() {
            self.shops.insert(shop_id.to_string(), s);
        }
    }

    pub(crate) fn open_auction(&mut self, shop_id: &str, kind: AuctionKind) {
        if let Some(old) = self.auctions.remove(shop_id) {
            if let Some(b) = old.high_bidder {
                self.move_coin(&sub("auction"), &b, old.high_bid.0, "auction cancelled");
            }
        }
        let day = self.processed_days;
        self.auctions.insert(
            shop_id.to_string(),
            Auction { shop_id: shop_id.to_string(), kind, opened_day: day, ends_day: day + 1, high_bidder: None, high_bid: U128(0) },
        );
        events::town("auction_opened", json!({ "shop": shop_id, "kind": kind, "ends_day": day + 1 }));
    }

    /// Called at the end of market day `day` for every auction that ends then.
    pub(crate) fn settle_auctions(&mut self, day: u32) {
        let due: Vec<Auction> = self.auctions.values().filter(|a| a.ends_day <= day).cloned().collect();
        let town = env::current_account_id();
        for a in due {
            let id = a.shop_id.clone();
            match (&a.high_bidder, a.kind) {
                (Some(winner), kind) => {
                    let to = if kind == AuctionKind::Bankruptcy { sub(&id) } else { town.clone() };
                    self.move_coin(&sub("auction"), &to, a.high_bid.0, "winning deed bid");
                    self.force_transfer_deed(&id, winner, "won at auction");
                    if kind == AuctionKind::Bankruptcy {
                        self.reopen(&id);
                    }
                    self.auctions.remove(&id);
                    events::town("auction_won", json!({ "shop": id, "winner": winner, "amount": a.high_bid, "kind": kind }));
                }
                (None, AuctionKind::Sale) => {
                    self.auctions.remove(&id);
                    events::town("auction_unsold", json!({ "shop": id }));
                }
                (None, AuctionKind::Bankruptcy) => {
                    let closed_for = day.saturating_sub(self.shop(&id).closed_day.unwrap_or(day));
                    let rescue = self.params.auction_reserve.0 * 2;
                    if closed_for + 1 >= self.params.auction_rescue_days && self.coin_of(&town) >= rescue {
                        self.move_coin(&town, &sub(&id), rescue, "town rescue");
                        self.reopen(&id);
                        self.auctions.remove(&id);
                        events::town("shop_rescued", json!({ "shop": id, "amount": U128(rescue) }));
                    } else {
                        let mut a = a.clone();
                        a.ends_day = day + 1;
                        self.auctions.insert(id, a);
                    }
                }
            }
        }
    }

    fn reopen(&mut self, shop_id: &str) {
        let mut s = self.shop(shop_id);
        s.open = true;
        s.missed_upkeep = 0;
        s.closed_day = None;
        s.day_start_cash = U128(self.coin_of(&sub(shop_id)));
        self.shops.insert(shop_id.to_string(), s);
        events::town("shop_reopened", json!({ "shop": shop_id }));
    }

    /// Live shop data in the token: wallets show the deed's current state, not a snapshot.
    fn decorate(&self, mut t: Token) -> Token {
        let Some(s) = self.shops.get(&t.token_id) else { return t };
        let acct = sub(&s.id);
        let cash = self.coin_of(&acct);
        let stock: Vec<String> = Item::ALL
            .iter()
            .filter(|i| s.target[i.idx()] > 0)
            .map(|i| format!("{} {}", self.items_of(&acct, *i), i.id()))
            .collect();
        let status = if self.auctions.get(&s.id).is_some() { "AT AUCTION" } else if s.open { "OPEN" } else { "CLOSED" };
        if let Some(m) = t.metadata.as_mut() {
            m.extra = Some(
                json!({
                    "account": acct, "open": s.open, "status": status, "cash": U128(cash),
                    "dividends_paid": s.dividends_paid, "stock": stock, "agent": s.agent,
                })
                .to_string(),
            );
            m.media = Some(deed_svg(&s.name, status, cash, &stock.join(" · ")));
        }
        t
    }
}

fn deed_svg(name: &str, status: &str, cash: u128, stock: &str) -> String {
    let colour = match status { "OPEN" => "#2f7d4f", "AT AUCTION" => "#b7791f", _ => "#a33" };
    let svg = format!(
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 260'>\
<rect width='400' height='260' rx='16' fill='#f6efe0' stroke='#6b4f2a' stroke-width='6'/>\
<text x='200' y='52' font-family='Georgia,serif' font-size='18' text-anchor='middle' fill='#6b4f2a'>DEED · MERIDIAN TOWN</text>\
<text x='200' y='104' font-family='Georgia,serif' font-size='26' text-anchor='middle' fill='#2b2118'>{name}</text>\
<text x='200' y='150' font-family='monospace' font-size='16' text-anchor='middle' fill='#2b2118'>till {cash:.0} MERI</text>\
<text x='200' y='178' font-family='monospace' font-size='13' text-anchor='middle' fill='#5a4a3a'>{stock}</text>\
<rect x='130' y='200' width='140' height='32' rx='8' fill='{colour}'/>\
<text x='200' y='222' font-family='monospace' font-size='14' text-anchor='middle' fill='#fff'>{status}</text></svg>",
        name = escape(name),
        cash = cash as f64 / 1e6,
        stock = escape(stock),
    );
    let mut out = String::from("data:image/svg+xml;utf8,");
    for c in svg.chars() {
        match c {
            '#' => out.push_str("%23"),
            '<' => out.push_str("%3C"),
            '>' => out.push_str("%3E"),
            '"' => out.push_str("%22"),
            '%' => out.push_str("%25"),
            _ => out.push(c),
        }
    }
    out
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('\'', "&apos;").replace('<', "&lt;").replace('>', "&gt;")
}
