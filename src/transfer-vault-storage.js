import { createCheckpointStorage, checkpointStorageError } from "./checkpoint-storage.js";
import { TransferError } from "./transfer-codec.js";
import { emptyVaultDocument, mutateVaultDocument, validateVaultDocument } from "./transfer-vault-model.js";

export const VAULT_DATABASE = "threecore-transfer-vault-v1";

/** Same transaction/commit machinery as checkpoints, distinct database and schema. */
export function createVaultStorage({ indexedDB, name = VAULT_DATABASE, openTimeoutMs } = {}) {
  return createCheckpointStorage({ indexedDB, name, ...(openTimeoutMs === undefined ? {} : { openTimeoutMs }),
    documentPolicy: {
      empty: emptyVaultDocument,
      validate: validateVaultDocument,
      mutate: mutateVaultDocument,
      mapError: error => error instanceof TransferError ? error : checkpointStorageError(error),
    },
  });
}
