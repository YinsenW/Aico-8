import type { HostAuthorityReceiptV1 } from "@aico8/contracts";

export interface AuthorityIdentity {
  readonly jobId: string;
  readonly gameId: string;
  readonly transferInstanceId: string;
  readonly sourceIdentitySha256: string;
  readonly targetProfileSha256: string;
  readonly manifestSha256: string;
  readonly authorityProfileSha256: string;
}

export interface AuthorityRecord {
  readonly operationId: string;
  readonly operationSha256: string;
  readonly identity: AuthorityIdentity;
  readonly receipt: HostAuthorityReceiptV1;
  readonly receiptSha256: string;
  readonly anchorStatus: "pending" | "anchored";
}

export interface AuthorityCommit {
  readonly operationId: string;
  readonly operationSha256: string;
  readonly expectedPreviousHead: string | null;
  readonly record: AuthorityRecord;
}

export type AuthorityCommitResult =
  | { readonly kind: "committed" | "idempotent"; readonly record: AuthorityRecord }
  | { readonly kind: "conflict"; readonly currentHead: string | null };

export interface AuthorityStore {
  readHead(transferInstanceId: string): Promise<AuthorityRecord | null>;
  readOperation(transferInstanceId: string, operationId: string): Promise<AuthorityRecord | null>;
  commit(command: AuthorityCommit): Promise<AuthorityCommitResult>;
  markAnchored(transferInstanceId: string, receiptSha256: string): Promise<void>;
  listPendingAnchors(): Promise<readonly AuthorityRecord[]>;
}

export interface ReceiptSigner {
  readonly keyId: string;
  sign(payload: Uint8Array): Promise<string>;
}

export interface AuthorityCheckpoint {
  readonly hostId: string;
  readonly transferInstanceId: string;
  readonly sequence: number;
  readonly receiptSha256: string;
  readonly previousReceiptSha256: string | null;
}

export interface RollbackAnchor {
  append(checkpoint: AuthorityCheckpoint): Promise<void>;
  latest(transferInstanceId: string): Promise<AuthorityCheckpoint | null>;
}
