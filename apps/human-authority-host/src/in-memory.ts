import type {
  AuthorityCheckpoint,
  AuthorityCommit,
  AuthorityCommitResult,
  AuthorityRecord,
  AuthorityStore,
  RollbackAnchor,
} from "./ports.js";

function operationKey(transferInstanceId: string, operationId: string): string {
  return `${transferInstanceId}:${operationId}`;
}

export class InMemoryAuthorityStore implements AuthorityStore {
  readonly #heads = new Map<string, AuthorityRecord>();
  readonly #operations = new Map<string, AuthorityRecord>();
  failNextMarkAnchored = false;

  async readHead(transferInstanceId: string): Promise<AuthorityRecord | null> {
    return this.#heads.get(transferInstanceId) ?? null;
  }

  async readOperation(transferInstanceId: string, operationId: string): Promise<AuthorityRecord | null> {
    return this.#operations.get(operationKey(transferInstanceId, operationId)) ?? null;
  }

  async commit(command: AuthorityCommit): Promise<AuthorityCommitResult> {
    const transferInstanceId = command.record.identity.transferInstanceId;
    const key = operationKey(transferInstanceId, command.operationId);
    const priorOperation = this.#operations.get(key);
    if (priorOperation) {
      return priorOperation.operationSha256 === command.operationSha256
        ? { kind: "idempotent", record: priorOperation }
        : { kind: "conflict", currentHead: this.#heads.get(transferInstanceId)?.receiptSha256 ?? null };
    }
    const current = this.#heads.get(transferInstanceId) ?? null;
    if ((current?.receiptSha256 ?? null) !== command.expectedPreviousHead) {
      return { kind: "conflict", currentHead: current?.receiptSha256 ?? null };
    }
    this.#heads.set(transferInstanceId, command.record);
    this.#operations.set(key, command.record);
    return { kind: "committed", record: command.record };
  }

  async markAnchored(transferInstanceId: string, receiptSha256: string): Promise<void> {
    if (this.failNextMarkAnchored) {
      this.failNextMarkAnchored = false;
      throw new Error("injected mark failure");
    }
    const current = this.#heads.get(transferInstanceId);
    if (!current || current.receiptSha256 !== receiptSha256) throw new Error("cannot anchor a non-current head");
    const anchored = { ...current, anchorStatus: "anchored" as const };
    this.#heads.set(transferInstanceId, anchored);
    this.#operations.set(operationKey(transferInstanceId, current.operationId), anchored);
  }

  async listPendingAnchors(): Promise<readonly AuthorityRecord[]> {
    return [...this.#heads.values()].filter((record) => record.anchorStatus === "pending");
  }
}

export class InMemoryRollbackAnchor implements RollbackAnchor {
  readonly #latest = new Map<string, AuthorityCheckpoint>();
  failNextAppend = false;

  async append(checkpoint: AuthorityCheckpoint): Promise<void> {
    if (this.failNextAppend) {
      this.failNextAppend = false;
      throw new Error("injected anchor failure");
    }
    const current = this.#latest.get(checkpoint.transferInstanceId);
    if (current?.receiptSha256 === checkpoint.receiptSha256) return;
    if ((current?.receiptSha256 ?? null) !== checkpoint.previousReceiptSha256
      || checkpoint.sequence !== (current?.sequence ?? 0) + 1) {
      throw new Error("checkpoint does not extend the immutable anchor");
    }
    this.#latest.set(checkpoint.transferInstanceId, checkpoint);
  }

  async latest(transferInstanceId: string): Promise<AuthorityCheckpoint | null> {
    return this.#latest.get(transferInstanceId) ?? null;
  }
}
