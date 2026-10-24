import { mountWorkspacePanel } from "/examples/workspace-panel.js";
import { mountSecureBackupPanel } from "/examples/secure-backup-panel.js";
import { encryptWorkspaceBackup } from "/src/secure-backup-crypto.js";
import { createPortfolioHistory } from "/src/portfolio-history.js";
import { workspaceFromDraft } from "/src/workspace-format.js";
import { inspectEncryptedBackup, encodeBackupBase64 } from "/src/secure-backup-format.js";

const PASSWORD = "synthetic browser only purple moon";
const assert = (condition, message) => { if (!condition) throw Error(message); };
const clone = value => JSON.parse(JSON.stringify(value));
const token = "0x" + "44".repeat(20);
const addresses = ["11", "22", "33"].map(pair => "0x" + pair.repeat(20));
function draft(empty = false) {
  return ["DAT", "EMA", "CAWELON"].map((agent, index) => {
    const history = createPortfolioHistory();
    if (!empty) history.add({
      agent, account: addresses[index], chainId: 84532,
      siteOrigin: "http://localhost:4184", connectionEpoch: 1,
      blockNumber: "10", blockHash: "0x" + "ab".repeat(32),
      nativeBalanceBaseUnits: String(16 + index),
      holdings: [{ address: token, hasCode: true, balanceBaseUnits: String(42 + index), notice: null }],
      readOnly: true, securityAudit: false,
    });
    return { agent, account: empty ? "" : addresses[index], chainId: 84532,
      tokenAddress: token, tokens: token, history: history.exportText() };
  });
}
async function waitFor(condition) {
  const deadline = Date.now() + 20000;
  while (!condition()) {
    if (Date.now() > deadline) throw Error("Encrypted backup UI did not settle");
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}
let backup;
async function sample() {
  backup ??= encryptWorkspaceBackup(workspaceFromDraft(draft()), PASSWORD);
  return backup;
}
function fixture(empty = false) {
  const host = document.createElement("div");
  document.body.append(host);
  let current = draft(empty);
  let writes = 0;
  const downloads = [];
  const panel = mountWorkspacePanel({ document, parent: host,
    readDraft: () => clone(current), writeDraft(value) { writes++; current = clone(value); },
    download: ({ prepared }) => downloads.push(prepared) });
  const q = name => host.querySelector(".secure-backup-" + name);
  const w = name => host.querySelector(".workspace-" + name);
  function input(element, value) { element.value = value; element.dispatchEvent(new Event("input", { bubbles: true })); }
  function check(element) { element.checked = true; element.dispatchEvent(new Event("change", { bubbles: true })); }
  async function select(text) {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], "synthetic-encrypted.json", { type: "application/json" }));
    q("file").files = transfer.files;
    q("file").dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => !q("file").disabled);
  }
  async function unlock(password = PASSWORD) {
    input(q("restore-password"), password);
    q("decrypt").click();
    assert(q("restore-password").value === "", "credential cleared before native result");
    await waitFor(() => !q("file").disabled);
  }
  return { q, w, panel, host, downloads, input, check, select, unlock,
    get writes() { return writes; }, get current() { return clone(current); },
    change() { current[0].tokens = ""; },
    dispose() { panel.dispose(); host.remove(); } };
}

export function registerSecureBackupUITests(test) {
  test("encrypted backup: integrated page requires no wallet connection", make => {
    const f = make();
    assert(document.querySelector(".secure-backup-panel"), "integrated panel present");
    assert(document.querySelector(".secure-backup-password").type === "password", "password concealed");
    assert(f.calls.length === 0, "no provider requests");
  });

  test("encrypted backup: actual native crypto prepares and explicitly downloads ciphertext", async () => {
    const f = fixture();
    try {
      f.input(f.q("password"), PASSWORD);
      f.input(f.q("confirmation"), PASSWORD);
      f.check(f.q("acknowledged"));
      f.q("encrypt").click();
      assert(f.q("password").value === "", "first credential cleared");
      assert(f.q("confirmation").value === "", "confirmation cleared");
      await waitFor(() => !f.q("download").disabled);
      assert(f.downloads.length === 0, "no automatic download");
      f.q("download").click();
      assert(f.downloads.length === 1, "explicit download offered");
      inspectEncryptedBackup(f.downloads[0].text);
      assert(!f.downloads[0].text.includes(addresses[0]), "address not plaintext");
      assert(!f.downloads[0].text.includes(PASSWORD), "password not exported");
      assert(f.writes === 0, "export does not restore");
    } finally { f.dispose(); }
  });

  test("encrypted backup: File stream, decrypt, stage, preview and explicit restore preserve all agents", async () => {
    const f = fixture(true);
    try {
      await f.select((await sample()).text);
      assert(!f.q("decrypt").disabled, "file accepted");
      assert(f.q("stage").disabled, "not decrypted");
      await f.unlock();
      assert(!f.q("stage").disabled, "decrypted candidate ready");
      assert(f.writes === 0 && f.w("json").value === "", "no automatic handoff");
      f.q("stage").click();
      assert(f.w("json").value.includes(addresses[2]), "three agents staged");
      assert(f.writes === 0, "handoff is not apply");
      f.w("preview").click();
      assert(f.w("apply").disabled, "human confirmation remains necessary");
      f.check(f.w("confirmed"));
      f.w("apply").click();
      assert(f.writes === 1, "one explicit apply");
      for (let index = 0; index < 3; index++) {
        assert(f.current[index].account === addresses[index], "correct agent account");
        assert(JSON.parse(f.current[index].history).reports[0].snapshot.blockNumber === "10", "saved history restored");
      }
    } finally { f.dispose(); }
  });

  test("encrypted backup: wrong passphrase never populates restore fields", async () => {
    const f = fixture(true);
    try {
      await f.select((await sample()).text);
      await f.unlock("synthetic incorrect phrase only");
      assert(f.q("stage").disabled, "no unlocked candidate");
      assert(f.w("json").value === "", "plaintext not released");
      assert(f.q("status").textContent.includes("合言葉が違うか"), "generic authentication message");
      assert(f.writes === 0, "no mutations");
    } finally { f.dispose(); }
  });

  test("encrypted backup: tampered native file fails authentication", async () => {
    const f = fixture(true);
    try {
      const text = (await sample()).text;
      const value = JSON.parse(text);
      const bytes = inspectEncryptedBackup(text).ciphertext;
      bytes[0] ^= 1;
      value.ciphertext = encodeBackupBase64(bytes);
      await f.select(JSON.stringify(value));
      await f.unlock();
      assert(f.q("stage").disabled && f.writes === 0, "tamper blocked");
      assert(f.w("json").value === "", "no plaintext after tamper");
    } finally { f.dispose(); }
  });

  test("encrypted backup: stop clears plaintext already handed to regular preview", async () => {
    const f = fixture(true);
    try {
      await f.select((await sample()).text);
      await f.unlock();
      f.q("stage").click();
      f.w("preview").click();
      f.check(f.w("confirmed"));
      assert(!f.w("apply").disabled, "preview prepared");
      f.panel.protect();
      assert(f.w("json").value === "", "staged plaintext cleared");
      assert(f.w("detail").textContent === "", "preview cleared");
      assert(f.w("apply").disabled, "old preview cannot apply");
      assert(f.writes === 0, "no mutations");
    } finally { f.dispose(); }
  });

  test("encrypted backup: target edit after unlock invalidates handoff", async () => {
    const f = fixture(true);
    try {
      await f.select((await sample()).text);
      await f.unlock();
      f.change();
      f.q("stage").click();
      assert(f.w("json").value === "", "stale target blocked");
      assert(f.q("status").textContent.includes("変わりました"), "stale explanation");
      assert(f.writes === 0, "no writes");
    } finally { f.dispose(); }
  });

  test("encrypted backup: manual cancel while native KDF runs cannot later enable restore", async () => {
    const f = fixture(true);
    try {
      await f.select((await sample()).text);
      f.input(f.q("restore-password"), PASSWORD);
      f.q("decrypt").click();
      f.q("cancel").click();
      await new Promise(resolve => setTimeout(resolve, 1200));
      assert(f.q("stage").disabled, "late result discarded");
      assert(f.w("json").value === "" && f.writes === 0, "no stale plaintext");
    } finally { f.dispose(); }
  });

  test("encrypted backup: reject plain file without falling back to plaintext restore", async () => {
    const f = fixture(true);
    try {
      await f.select(JSON.stringify(workspaceFromDraft(draft())));
      assert(f.q("decrypt").disabled, "wrong format rejected");
      assert(f.w("json").value === "" && f.writes === 0, "no automatic fallback");
    } finally { f.dispose(); }
  });

  test("encrypted backup: expiry clears entered passwords in actual DOM", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const panel = mountSecureBackupPanel({ document, parent: host,
      readDraft: draft, onStage: () => true, plaintextLifetimeMs: 30 });
    try {
      const password = host.querySelector(".secure-backup-password");
      password.value = PASSWORD;
      password.dispatchEvent(new Event("input"));
      await waitFor(() => password.value === "");
      assert(host.querySelector(".secure-backup-status").textContent.includes("一定時間"), "expiry explained");
    } finally { panel.dispose(); host.remove(); }
  });
}
