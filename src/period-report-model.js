import { periodFail, periodShape } from "./period-plan.js";
import { validateLibraryEntry, validatePeriodLibrary, libraryArray,
  libraryId, libraryLabel, libraryTime } from "./period-library-model.js";

export const PERIOD_REPORT_SCHEMA = "threecore.period-report-input.v1";
export const PERIOD_REPORT_AGENTS = Object.freeze(["DAT", "EMA", "CAWELON"]);
export const PERIOD_REPORT_INPUT_LIMIT = 48 * 1024 * 1024;

export function reportAgent(value) {
  if (!PERIOD_REPORT_AGENTS.includes(value)) periodFail("PERIOD_REPORT_AGENT");
  return value;
}

export function emptyReportSelection() {
  return Object.freeze({ DAT: null, EMA: null, CAWELON: null });
}

export function validateReportSelection(input) {
  periodShape(input, PERIOD_REPORT_AGENTS);
  return Object.freeze(Object.fromEntries(PERIOD_REPORT_AGENTS.map(agent =>
    [agent, input[agent] === null ? null : libraryId(input[agent])])));
}

/** The portable input holds original evidence, never a trusted imported conclusion. */
export function validatePeriodReportInput(input) {
  periodShape(input, ["schema", "title", "createdAt", "slots", "historicalOnly", "independentlyVerified"]);
  if (input.schema !== PERIOD_REPORT_SCHEMA || input.historicalOnly !== true ||
      input.independentlyVerified !== false) periodFail("PERIOD_REPORT_SCHEMA");
  const title = libraryLabel(input.title), createdAt = libraryTime(input.createdAt);
  if (title !== input.title) periodFail("PERIOD_REPORT_TITLE");
  if (libraryArray(input.slots).length !== 3) periodFail("PERIOD_REPORT_SLOTS");
  const ids = new Set();
  const slots = PERIOD_REPORT_AGENTS.map((agent, index) => {
    const slot = input.slots[index];
    periodShape(slot, ["agent", "entry"]);
    if (slot.agent !== agent) periodFail("PERIOD_REPORT_SLOTS");
    const entry = slot.entry === null ? null : validateLibraryEntry(slot.entry);
    if (entry) {
      if (entry.draft.plan.context.agent !== agent) periodFail("PERIOD_REPORT_AGENT");
      if (ids.has(entry.id)) periodFail("PERIOD_REPORT_DUPLICATE");
      ids.add(entry.id);
    }
    return Object.freeze({ agent, entry });
  });
  if (!ids.size) periodFail("PERIOD_REPORT_EMPTY");
  const result = Object.freeze({ schema: PERIOD_REPORT_SCHEMA, title, createdAt,
    slots: Object.freeze(slots), historicalOnly: true, independentlyVerified: false });
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > PERIOD_REPORT_INPUT_LIMIT) {
    periodFail("PERIOD_REPORT_SIZE");
  }
  return result;
}

/** Selection is explicit, including archived, incomplete and quarantined records. */
export function createPeriodReportInput(documentInput, selectionInput, title, createdAt) {
  const document = validatePeriodLibrary(documentInput), selection = validateReportSelection(selectionInput);
  const slots = PERIOD_REPORT_AGENTS.map(agent => {
    const id = selection[agent];
    const entry = id === null ? null : document.entries.find(row => row.id === id);
    if (entry === undefined) periodFail("PERIOD_REPORT_SOURCE_MISSING");
    return { agent, entry };
  });
  return validatePeriodReportInput({ schema: PERIOD_REPORT_SCHEMA, title: libraryLabel(title),
    createdAt, slots, historicalOnly: true, independentlyVerified: false });
}

export function periodReportInputKey(input) {
  return JSON.stringify(validatePeriodReportInput(input));
}

/** Changes to any selected record invalidate the review; unrelated writes are allowed. */
export function assertReportSourcesUnchanged(input, freshInput) {
  const report = validatePeriodReportInput(input), fresh = validatePeriodLibrary(freshInput);
  for (const { entry } of report.slots) {
    if (!entry) continue;
    const current = fresh.entries.find(row => row.id === entry.id);
    if (!current || JSON.stringify(current) !== JSON.stringify(entry)) periodFail("PERIOD_REPORT_SOURCE_CHANGED");
  }
  return fresh;
}
