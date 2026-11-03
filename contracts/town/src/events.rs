//! NEP-297 event logs: NEP-245 for items, and a `meridian` standard for town events.

use near_sdk::serde_json::{json, Value};
use near_sdk::{env, AccountId};

use crate::params::Item;

fn emit(standard: &str, version: &str, event: &str, data: Value) {
    let body = json!({ "standard": standard, "version": version, "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{body}"));
}

pub fn mt_mint(owner: &AccountId, item: Item, amount: u64, memo: &str) {
    emit("nep245", "1.0.0", "mt_mint", json!({
        "owner_id": owner, "token_ids": [item.id()], "amounts": [amount.to_string()], "memo": memo,
    }));
}

pub fn mt_burn(owner: &AccountId, item: Item, amount: u64, memo: &str) {
    emit("nep245", "1.0.0", "mt_burn", json!({
        "owner_id": owner, "token_ids": [item.id()], "amounts": [amount.to_string()], "memo": memo,
    }));
}

pub fn mt_transfer(from: &AccountId, to: &AccountId, items: &[(Item, u64)], memo: Option<&str>) {
    let ids: Vec<&str> = items.iter().map(|(i, _)| i.id()).collect();
    let amounts: Vec<String> = items.iter().map(|(_, a)| a.to_string()).collect();
    let mut data = json!({ "old_owner_id": from, "new_owner_id": to, "token_ids": ids, "amounts": amounts });
    if let Some(m) = memo {
        data["memo"] = json!(m);
    }
    emit("nep245", "1.0.0", "mt_transfer", data);
}

pub fn town(event: &str, data: Value) {
    emit("meridian", "0.1.0", event, data);
}
