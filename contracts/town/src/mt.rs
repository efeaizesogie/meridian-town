//! Items as NEP-245 multi-tokens: wood, ore, wheat, bread, tool, all in this contract.
//! `mt_transfer_call` and approvals aren't supported yet.

use near_sdk::json_types::U128;
use near_sdk::{assert_one_yocto, env, near, require, AccountId};

use crate::events;
use crate::params::Item;
use crate::{Town, TownExt};

#[near(serializers = [json])]
pub struct MtToken {
    pub token_id: String,
    pub owner_id: Option<AccountId>,
}

#[near(serializers = [json])]
pub struct MtContractMetadata {
    pub spec: String,
    pub name: String,
}

fn parse(token_id: &str) -> Item {
    Item::from_id(token_id).unwrap_or_else(|| env::panic_str("unknown token_id"))
}

impl Town {
    pub(crate) fn items_of(&self, account: &AccountId, item: Item) -> u64 {
        self.items.get(&(account.clone(), item)).copied().unwrap_or(0)
    }

    fn set_items(&mut self, account: &AccountId, item: Item, amount: u64) {
        if amount == 0 {
            self.items.remove(&(account.clone(), item));
        } else {
            self.items.insert((account.clone(), item), amount);
        }
    }

    pub(crate) fn mint_items(&mut self, to: &AccountId, item: Item, amount: u64, memo: &str) {
        if amount == 0 {
            return;
        }
        let bal = self.items_of(to, item);
        self.set_items(to, item, bal + amount);
        self.item_supply[item.idx()] += amount;
        events::mt_mint(to, item, amount, memo);
    }

    pub(crate) fn burn_items(&mut self, from: &AccountId, item: Item, amount: u64, memo: &str) {
        if amount == 0 {
            return;
        }
        let bal = self.items_of(from, item);
        require!(bal >= amount, "not enough items");
        self.set_items(from, item, bal - amount);
        self.item_supply[item.idx()] -= amount;
        events::mt_burn(from, item, amount, memo);
    }

    pub(crate) fn move_items(&mut self, from: &AccountId, to: &AccountId, item: Item, amount: u64, memo: Option<&str>) {
        if amount == 0 || from == to {
            return;
        }
        let bal = self.items_of(from, item);
        require!(bal >= amount, format!("{from} has {bal} {}, needs {amount}", item.id()));
        self.set_items(from, item, bal - amount);
        let to_bal = self.items_of(to, item);
        self.set_items(to, item, to_bal + amount);
        events::mt_transfer(from, to, &[(item, amount)], memo);
    }
}

#[near]
impl Town {
    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 {
        U128(self.items_of(&account_id, parse(&token_id)) as u128)
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128> {
        token_ids.iter().map(|t| U128(self.items_of(&account_id, parse(t)) as u128)).collect()
    }

    pub fn mt_supply(&self, token_id: String) -> Option<U128> {
        Some(U128(self.item_supply[parse(&token_id).idx()] as u128))
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<String>) -> Vec<Option<U128>> {
        token_ids.into_iter().map(|t| self.mt_supply(t)).collect()
    }

    pub fn mt_token(&self, token_ids: Vec<String>) -> Vec<Option<MtToken>> {
        token_ids
            .into_iter()
            .map(|t| Item::from_id(&t).map(|_| MtToken { token_id: t, owner_id: None }))
            .collect()
    }

    pub fn mt_metadata_contract(&self) -> MtContractMetadata {
        MtContractMetadata { spec: "mt-1.0.0".into(), name: "Meridian Town goods".into() }
    }

    #[payable]
    pub fn mt_transfer(&mut self, receiver_id: AccountId, token_id: String, amount: U128, approval: Option<(AccountId, u64)>, memo: Option<String>) {
        assert_one_yocto();
        require!(approval.is_none(), "approvals are not supported");
        let item = parse(&token_id);
        let amount = u64::try_from(amount.0).unwrap_or_else(|_| env::panic_str("amount too large"));
        require!(amount > 0, "amount must be positive");
        self.move_items(&env::predecessor_account_id(), &receiver_id, item, amount, memo.as_deref());
    }

    #[payable]
    pub fn mt_batch_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        require!(approvals.map_or(true, |a| a.iter().all(Option::is_none)), "approvals are not supported");
        require!(token_ids.len() == amounts.len(), "token_ids and amounts differ in length");
        let sender = env::predecessor_account_id();
        for (t, a) in token_ids.iter().zip(amounts) {
            let amount = u64::try_from(a.0).unwrap_or_else(|_| env::panic_str("amount too large"));
            self.move_items(&sender, &receiver_id, parse(t), amount, memo.as_deref());
        }
    }
}
