import { createCheckpointStorage, checkpointStorageError } from "./checkpoint-storage.js";
import { PeriodError } from "./period-plan.js";
import { emptyReportHistory, validateReportHistory, mutateReportHistory } from "./report-history-model.js";

export const REPORT_HISTORY_DATABASE = "threecore-report-history-v1";

/** A separate database; never migrate or replace saved acquisition checkpoints. */
export function createReportHistoryStorage({ indexedDB, name = REPORT_HISTORY_DATABASE, openTimeoutMs } = {}) {
  return createCheckpointStorage({ indexedDB, name, ...(openTimeoutMs === undefined ? {} : { openTimeoutMs }),
    documentPolicy: {
      empty: emptyReportHistory,
      validate: validateReportHistory,
      mutate: mutateReportHistory,
      mapError: value => value instanceof PeriodError ? value : checkpointStorageError(value),
    },
  });
}
