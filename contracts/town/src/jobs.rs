//! Delivery contracts with escrow (RULES.md §5). The shop's agent posts; payment is
//! locked up front; each delivered unit releases its share. The delivery is the proof.

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, require};

use crate::params::Item;
use crate::pricing::bid;
use crate::{events, sub, Job, Shop, Town, TownExt};

#[near]
impl Town {
    /// Agent: move a shop's target stock, within ±30% of its genesis target.
    pub fn set_target(&mut self, shop_id: String, item: Item, target: u64) {
        let mut s = self.shop(&shop_id);
        self.assert_operator(&s);
        let g = s.genesis_target[item.idx()];
        require!(g > 0, "this shop doesn't stock that");
        let band = g * self.params.agent_target_band_bps as u64 / 10_000;
        require!(target >= g - band && target <= g + band, format!("target must be within {}..={}", g - band, g + band));
        s.target[item.idx()] = target;
        self.shops.insert(shop_id, s);
    }

    /// Agent: post a delivery contract. Escrow comes out of the shop's cash immediately.
    pub fn post_job(&mut self, shop_id: String, item: Item, quantity: u64, unit_price: U128, hours: u32) -> u64 {
        self.catch_up();
        let s = self.shop(&shop_id);
        self.assert_operator(&s);
        require!(s.open, "shop is closed");
        require!(item.is_raw() && s.buys.contains(&item), "contracts are for raw goods this shop buys");
        require!(!self.jobs.values().any(|j| j.shop_id == shop_id && j.item == item), "a contract for this is already open");
        require!(hours >= 1 && hours <= self.params.job_max_hours, "bad duration");

        let acct = sub(&shop_id);
        let (stock, target, cash) = (self.items_of(&acct, item), s.target[item.idx()], self.coin_of(&acct));
        require!(stock * 10_000 < target * self.params.job_trigger_bps as u64, "stock isn't low enough for a contract");
        let max_qty = (target * 6 / 10).saturating_sub(stock);
        require!(quantity >= 1 && quantity <= max_qty, format!("quantity must be 1..={max_qty}"));
        let max_price = bid(&self.params, self.params.base(item), stock, target, cash) * (10_000 + self.params.job_premium_bps as u128) / 10_000;
        require!(unit_price.0 > 0 && unit_price.0 <= max_price, format!("unit price must be at most {max_price}"));
        let escrow = unit_price.0 * quantity as u128;
        require!(escrow * 2 <= cash, "escrow can't exceed half the shop's cash");

        self.move_coin(&acct, &sub("escrow"), escrow, "contract escrow");
        let id = self.next_job_id;
        self.next_job_id += 1;
        let deadline_ns = env::block_timestamp() + hours as u64 * 3_600_000_000_000;
        self.jobs.insert(id, Job { id, shop_id: shop_id.clone(), item, remaining: quantity, unit_price, deadline_ns });
        events::town("job_posted", json!({
            "id": id, "shop": shop_id, "item": item.id(), "quantity": quantity,
            "unit_price": unit_price, "deadline_ns": deadline_ns.to_string(),
        }));
        id
    }

    /// Player: deliver up to `quantity` units into the contract; get paid per unit.
    pub fn deliver(&mut self, job_id: u64, quantity: u64) -> U128 {
        self.catch_up();
        let player = env::predecessor_account_id();
        let mut job = self.jobs.get(&job_id).cloned().unwrap_or_else(|| env::panic_str("no such contract"));
        require!(env::block_timestamp() < job.deadline_ns, "contract expired");
        require!(self.shop(&job.shop_id).open, "shop is closed");
        let n = quantity.min(job.remaining);
        require!(n > 0, "nothing to deliver");
        let pay = job.unit_price.0 * n as u128;

        self.move_items(&player, &sub(&job.shop_id), job.item, n, Some("contract delivery"));
        self.move_coin(&sub("escrow"), &player, pay, "contract payment");
        self.record_volume(&player, pay);
        job.remaining -= n;
        events::town("job_delivered", json!({ "id": job_id, "player": player, "quantity": n, "paid": U128(pay), "remaining": job.remaining }));
        if job.remaining == 0 {
            self.jobs.remove(&job_id);
        } else {
            self.jobs.insert(job_id, job);
        }
        U128(pay)
    }

    /// Anyone: after the deadline, return unspent escrow to the shop.
    pub fn expire_job(&mut self, job_id: u64) -> U128 {
        let job = self.jobs.get(&job_id).cloned().unwrap_or_else(|| env::panic_str("no such contract"));
        require!(env::block_timestamp() >= job.deadline_ns, "contract still running");
        let refund = job.unit_price.0 * job.remaining as u128;
        self.move_coin(&sub("escrow"), &sub(&job.shop_id), refund, "contract refund");
        self.jobs.remove(&job_id);
        events::town("job_expired", json!({ "id": job_id, "refund": U128(refund) }));
        U128(refund)
    }

    pub fn get_jobs(&self) -> Vec<Job> {
        self.jobs.values().cloned().collect()
    }
}

impl Town {
    /// The shop's agent, its deed holder, or the owner while the town holds the deed.
    fn assert_operator(&self, s: &Shop) {
        let caller = env::predecessor_account_id();
        let holder = self.deed_owner(&s.id);
        let town_held = holder == env::current_account_id();
        require!(
            s.agent.as_ref() == Some(&caller) || caller == holder || (town_held && caller == self.owner),
            "only this shop's agent"
        );
    }
}
