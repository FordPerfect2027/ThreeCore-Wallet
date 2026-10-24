import { mountSecureBackupPanel } from "../../examples/secure-backup-panel.js";
import { mountWorkspacePanel } from "../../examples/workspace-panel.js";
import { createSecureBackupRunner } from "../../src/secure-backup-runner.js";
import { Element } from "./panel-dom.js";
import { draft, clone, fakePrepared, fakeDecoded, encryptedText, PASSWORD, fileObject } from "./secure-backup-fixtures.js";
import { until } from "./workspace-fixtures.js";
import { manualTime } from "./secure-lifecycle-time.js";

export function lifecyclePanel({ workspace = false, ...options } = {}) {
  const time = manualTime();
  const document = new EventTarget();
  const eventTarget = new EventTarget();
  document.defaultView = eventTarget;
  document.hidden = false;
  document.createElement = tag => new Element(tag);
  const parent = new Element("main");
  let current = draft({ block: "10" });
  const writes = [];
  const downloads = [];
  const staged = [];
  let protects = 0;
  const runner = createSecureBackupRunner();
  const common = { document, parent, readDraft: () => clone(current),
    download: value => { downloads.push(value.prepared); },
    ...options };
  const secure = { plaintextLifetimeMs: 100, deadlineOptions: time.options,
    controllerOptions: { runner, encrypt: async () => fakePrepared(), decrypt: async () => fakeDecoded(),
      ...options.controllerOptions }, ...options.secureOptions };
  const panel = workspace ? mountWorkspacePanel({ ...common, secureOptions: secure,
    writeDraft(value) { writes.push(clone(value)); current = clone(value); } }) :
    mountSecureBackupPanel({ ...common, ...secure, eventTarget,
      onStage(text) { staged.push(text); return true; },
      onProtect() { protects++; }, ...options });
  const q = name => parent.find("secure-backup-" + name);
  const w = name => parent.find("workspace-" + name);
  function input(name, value) {
    q(name).value = value;
    q(name).dispatchEvent(new Event("input"));
  }
  function check(item, value = true) {
    item.checked = value;
    item.dispatchEvent(new Event("change"));
  }
  async function seal() {
    input("password", PASSWORD);
    input("confirmation", PASSWORD);
    check(q("acknowledged"));
    q("encrypt").click();
    await until(() => !q("file").disabled);
  }
  async function select() {
    q("file").files = [fileObject(encryptedText())];
    q("file").dispatchEvent(new Event("change"));
    await until(() => !q("file").disabled);
  }
  async function unlock() {
    await select();
    input("restore-password", PASSWORD);
    q("decrypt").click();
    await until(() => !q("file").disabled);
  }
  return { panel, document, eventTarget, parent, q, w, time, runner, input, check,
    seal, select, unlock, downloads, writes, staged,
    get protections() { return protects; }, get current() { return clone(current); },
    dispose() { panel.dispose(); runner.dispose(); } };
}
