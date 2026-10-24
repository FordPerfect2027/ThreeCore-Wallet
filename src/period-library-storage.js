import { createCheckpointStorage, checkpointStorageError } from "./checkpoint-storage.js";
import { PeriodError } from "./period-plan.js";
import { emptyPeriodLibrary, validatePeriodLibrary, mutatePeriodLibrary } from "./period-library-model.js";

export const PERIOD_LIBRARY_DATABASE = "threecore-period-library-v1";

/** Reuse the committed-transaction adapter, without sharing another feature's database. */
export function createPeriodLibraryStorage({ indexedDB, name = PERIOD_LIBRARY_DATABASE, openTimeoutMs, transactionTimeoutMs, guard, deadlineOptions, snapshotLimits } = {}) {
  return createCheckpointStorage({ indexedDB, name, transactionTimeoutMs, guard, deadlineOptions, snapshotLimits, ...(openTimeoutMs === undefined ? {} : { openTimeoutMs }),
    documentPolicy: {
      empty: emptyPeriodLibrary,
      validate: validatePeriodLibrary,
      mutate: mutatePeriodLibrary,
      mapError: error => error instanceof PeriodError ? error : checkpointStorageError(error),
    },
  });
}
