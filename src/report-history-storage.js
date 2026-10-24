import { createCheckpointStorage, checkpointStorageError } from "./checkpoint-storage.js";
import { PeriodError } from "./period-plan.js";
import { emptyReportHistory, validateReportHistory, mutateReportHistory } from "./report-history-model.js";

export const REPORT_HISTORY_DATABASE = "threecore-report-history-v1";

/** A separate database; never migrate or replace saved acquisition checkpoints. */
export function createReportHistoryStorage({ indexedDB, name = REPORT_HISTORY_DATABASE, openTimeoutMs, transactionTimeoutMs, guard, deadlineOptions, snapshotLimits } = {}) {
  return createCheckpointStorage({ indexedDB, name, transactionTimeoutMs, guard, deadlineOptions, snapshotLimits, ...(openTimeoutMs === undefined ? {} : { openTimeoutMs }),
    documentPolicy: {
      empty: emptyReportHistory,
      validate: validateReportHistory,
      mutate: mutateReportHistory,
      mapError: value => value instanceof PeriodError ? value : checkpointStorageError(value),
    },
  });
}
