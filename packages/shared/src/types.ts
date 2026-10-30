// Shared shapes (docs/SPEC.md §1–2). Mirrored in checker/src/types.rs and the guard-registry contract.

export type Preset = 'safer' | 'balanced' | 'lean';

/** Sealed and committed; only the owner's device and the checker's enclave ever see it. */
export interface GuardSettings {
  /** EVM address (0x…, EIP-191) or `ed25519:<base58>` (NEP-413). Never a NEAR account name. */
  owner: string;
  hl_address: string;
  /** 64 lowercase hex characters. */
  account_salt: string;
  preset: Preset;
  line_range_pct: [number, number];
  target_range_pct: [number, number];
  speed_aware: boolean;
  max_rescue_usd: number;
  budget_usd: number;
  /** 1Click asset id, e.g. `nep141:nbtc.bridge.near`. */
  reserve_asset: string;
  cooldown_s: number;
  isolated: { coin: string } | null;
  close_hint: { chain: string; address: string } | null;
  /** The owner's X25519 key, for sealed receipts and arm records. */
  receipt_pk: string;
  /** Nanoseconds since the epoch, as a decimal string (it exceeds 2^53). */
  expires_at: string;
}

export type GuardStatus = 'Pending' | 'Guarding' | 'Closed' | 'Expired';
export type Outcome = 'pending' | 'saved' | 'early' | 'failed';

/** Public part of a receipt: rounded so a rescue can't be matched to an account (ARCHITECTURE §2 rule 6). */
export interface PublicReceipt {
  at_hour: number;
  credit_usd: number;
  attestation_ref: string;
  latency_s: number;
  outcome: Outcome;
}

export interface RescueReceipt {
  public: PublicReceipt;
  /** Exact amounts, encrypted to the owner's receipt key. */
  sealed: string;
  /** Present only when the owner publishes proof. */
  proof: { at: number; hl_credit_usd: number; hl_tx: string } | null;
}

export interface ArmRecord {
  at: number;
  epoch: number;
  /** The drawn line and target, encrypted to the owner. */
  sealed: string;
}

/** What the registry stores. No address anywhere (T-PRIV-01). */
export interface Guard {
  guard_id: string;
  owner_commitment: string;
  account_commitment: string;
  commitment: string;
  wallet_pubkey: string;
  status: GuardStatus;
  created_at: number;
  expires_at: string;
  receipts: RescueReceipt[];
  arms: ArmRecord[];
  check_budget: string;
}

/** One Hyperliquid position as the guard logic reads it from `clearinghouseState`. */
export interface Position {
  coin: string;
  szi: number;
  position_value: number;
  liquidation_px: number | null;
  leverage_type: 'cross' | 'isolated';
}

/** Checker output: a status and nothing else (rule 4, T-PRIV-03). */
export type CheckStatus = 'guarding' | 'rescued' | 'pending' | 'skipped';
