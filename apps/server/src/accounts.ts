// Accounts the game runs for its agents: each gets a little NEAR for gas and one key that
// can call only the listed town methods. Keys live in apps/server/data/<file> (git-ignored).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Account, KeyPair, PublicKey, actions, nearToYocto } from 'near-api-js';
import { GAME, TOWN, accountExists, game, hasKey, provider } from './chain.ts';
import { dataFile } from './data.ts';

interface Saved {
  accountId: string;
  secretKey: string;
  pending?: boolean;
}

export class KeyStore {
  private file: string;
  keys: Record<string, Saved>;
  private signers: Record<string, Account> = {};

  /**
   * Keys load from `file` in the data directory, or from the environment variable
   * MERIDIAN_KEYS_<NAME> (e.g. MERIDIAN_KEYS_AGENTS for agents.json) on hosts without a disk.
   */
  constructor(file: string) {
    this.file = dataFile(file);
    const env = process.env[`MERIDIAN_KEYS_${file.replace(/\.json$/, '').toUpperCase()}`];
    this.keys = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : env ? JSON.parse(env) : {};
  }

  private save() {
    writeFileSync(this.file, JSON.stringify(this.keys, null, 1));
  }

  ready(id: string) {
    return !!this.keys[id] && !this.keys[id].pending;
  }

  accountId(id: string, name: string) {
    return this.keys[id]?.accountId ?? `${name}.${GAME}`;
  }

  signer(id: string): Account {
    return (this.signers[id] ??= new Account(this.keys[id].accountId, provider, this.keys[id].secretKey as any));
  }

  /**
   * Create `<name>.<game>` (or `<name>2…` if that name is taken without our key). The key
   * is saved before the transaction is sent, so a dropped response can't orphan an account.
   */
  async ensure(id: string, name: string, methods: string[], fund = '0.15') {
    const saved = this.keys[id];
    if (saved && !saved.pending) return;
    if (saved?.pending) {
      const pk = KeyPair.fromString(saved.secretKey as any).getPublicKey().toString();
      if (await hasKey(saved.accountId, pk)) {
        delete saved.pending;
        this.save();
        return;
      }
    }
    let accountId = saved?.accountId ?? `${name}.${GAME}`;
    for (let n = 2; !saved?.pending && (await accountExists(accountId)); n++) accountId = `${name}${n}.${GAME}`;
    const key = saved?.pending ? KeyPair.fromString(saved.secretKey as any) : KeyPair.fromRandom('ed25519');
    this.keys[id] = { accountId, secretKey: key.toString(), pending: true };
    this.save();
    await game.signAndSendTransaction({
      receiverId: accountId,
      actions: [
        actions.createAccount(),
        actions.transfer(nearToYocto(fund)),
        actions.addFunctionCallAccessKey(PublicKey.fromString(key.getPublicKey().toString()), TOWN, methods, nearToYocto('0.5')),
      ],
    });
    delete this.keys[id].pending;
    this.save();
    console.log(`created ${accountId}`);
  }
}

/** Retry `fn` a few times: public RPCs rate-limit, especially at startup. */
export async function withRetries(label: string, fn: () => Promise<void>, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      console.error(`${label} (attempt ${i + 1}):`, e instanceof Error ? e.message : e);
      await new Promise(r => setTimeout(r, 10_000));
    }
  }
}
