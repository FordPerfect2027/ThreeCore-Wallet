import { emptyCheckpointDocument, mutateCheckpoints, validateCheckpointDocument } from "../../src/checkpoint-model.js";
import { prepareWorkspaceFile } from "../../src/workspace-file.js";
import { workspaceFromDraft } from "../../src/workspace-format.js";
import { draft, clone } from "./workspace-fixtures.js";

export const TIME = "2026-10-23T04:05:06.000Z";
export const LATER = "2026-10-23T05:06:07.000Z";
export const EARLIER = "2026-10-22T04:05:06.000Z";
export const id = number => "11111111-2222-4333-8444-" + String(number).padStart(12, "0");
export const saveOperation = (number = 1, fileText = "{}") => ({
  kind: "save", id: id(number), label: "控え " + number, time: TIME, fileText,
});
export function stored(count = 1, fileText = "{}") {
  let document = emptyCheckpointDocument();
  for (let index = 1; index <= count; index++) document = mutateCheckpoints(document, document.revision, saveOperation(index, fileText));
  return clone(document);
}
export async function preparedDraft(options) {
  return prepareWorkspaceFile(workspaceFromDraft(draft(options)));
}

/** An atomic in-memory repository for controller tests; browser tests exercise IndexedDB. */
export function memoryStorage(initial = emptyCheckpointDocument()) {
  let document = validateCheckpointDocument(initial);
  let closed = false;
  const calls = [];
  let beforeRead = async () => {};
  let beforeChange = async () => {};
  let afterChange = () => {};
  return {
    calls,
    current: () => clone(document),
    set: value => { document = validateCheckpointDocument(value); },
    onRead: hook => { beforeRead = hook; },
    onChange: hook => { beforeChange = hook; },
    onAfterChange: hook => { afterChange = hook; },
    async read() {
      calls.push("read");
      await beforeRead();
      if (closed) throw Object.assign(Error("Closed"), { code: "CHECKPOINT_CLOSED" });
      return validateCheckpointDocument(clone(document));
    },
    async change(revision, operation, { canCommit = () => true } = {}) {
      calls.push(operation.kind);
      await beforeChange();
      if (closed) throw Object.assign(Error("Closed"), { code: "CHECKPOINT_CLOSED" });
      const candidate = mutateCheckpoints(document, revision, operation);
      if (!canCommit()) throw Object.assign(Error("Cancelled"), { code: "CHECKPOINT_CANCELLED" });
      document = candidate;
      afterChange();
      return validateCheckpointDocument(clone(document));
    },
    close() { closed = true; calls.push("close"); },
  };
}
