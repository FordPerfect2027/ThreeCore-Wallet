import { mountWalletSetupPanel } from "/examples/wallet-setup-panel.js";
import { mountWorkspacePanel } from "/examples/workspace-panel.js";
import { createWalletProviderRegistry, ANNOUNCE_EVENT, REQUEST_EVENT } from "/src/provider-registry.js";
import { encodeWalletSetup } from "/src/wallet-setup.js";
import { draft, text, clone } from "../helpers/workspace-fixtures.js";

const assert = (value, message) => { if (!value) throw Error(message); };
const equal = (left, right, message) => assert(JSON.stringify(left) === JSON.stringify(right), message);
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const agents = ["DAT", "EMA", "CAWELON"];
const accounts = ["11", "22", "33"].map(pair => "0x" + pair.repeat(20));
const fields = () => agents.map(agent => ({ agent, account: "", chainId: 84532 }));
const plan = () => ({ schema: "threecore-wallet-setup-v1", entries: agents.map((agent, index) => ({
  agent, account: accounts[index], chainId: 84532,
})) });
function host() {
  const parent = document.createElement("section"); document.body.append(parent); return parent;
}
function confirm(parent, prefix, checkbox, payload) {
  const node = name => parent.querySelector("." + prefix + "-" + name);
  node("json").value = payload; node("json").dispatchEvent(new Event("input", { bubbles: true }));
  node("preview").click(); node(checkbox).checked = true;
  node(checkbox).dispatchEvent(new Event("change", { bubbles: true }));
  assert(!node("apply").disabled, "review must authorize one explicit apply click");
  node("apply").click(); return node;
}

export function registerRestoreConfirmationUITests(test) {
  for (const missing of agents) {
    test(`restore-confirmation: ${missing} partial settings show failure then a fresh review succeeds`, async () => {
      const parent = host(); let current = fields(), incomplete = true, writes = 0;
      const panel = mountWalletSetupPanel({ document, parent, readFields: () => current,
        applyPlan(value) {
          writes++; current = value.entries.map(row => ({ ...row,
            account: incomplete && row.agent === missing ? "" : row.account }));
        } });
      try {
        const node = confirm(parent, "wallet-setup", "confirm", encodeWalletSetup(plan()));
        assert(node("status").textContent.includes("3枚すべて"), "partial result must be visible");
        assert(!node("status").textContent.includes("の設定を反映しました"), "must not report full success");
        assert(node("apply").disabled && !node("confirm").checked, "old confirmation consumed");
        incomplete = false;
        confirm(parent, "wallet-setup", "confirm", encodeWalletSetup(plan()));
        assert(node("status").textContent.includes(missing + "の設定を反映しました"), "retry confirms actual remaining change");
        equal(current, plan().entries, "all three values verified"); assert(writes === 2, "one write per reviewed attempt");
      } finally { panel.dispose(); parent.remove(); }
    });
  }
  for (const boundary of ["prepare", "write"]) {
    test(`restore-confirmation: failed setup ${boundary} cannot display success`, async () => {
      const parent = host(); let current = fields(), writes = 0;
      const panel = mountWalletSetupPanel({ document, parent, readFields: () => current,
        prepareApply: () => boundary !== "prepare",
        applyPlan(value) { writes++; current = value.entries; return false; } });
      try {
        const node = confirm(parent, "wallet-setup", "confirm", encodeWalletSetup(plan()));
        assert(node("status").textContent.includes("完了できません"), "failed receipt shown");
        assert(writes === (boundary === "prepare" ? 0 : 1), "preparation gates all writes");
        assert(node("apply").disabled, "failed review is not reusable");
      } finally { panel.dispose(); parent.remove(); }
    });
  }
  test("restore-confirmation: delayed settings writer blocks a second review and late success", async () => {
    const parent = host(); let current = fields(), settle;
    const pending = new Promise(resolve => { settle = resolve; });
    const panel = mountWalletSetupPanel({ document, parent, readFields: () => current,
      applyPlan: value => pending.then(() => { current = value.entries; }) });
    try {
      const node = confirm(parent, "wallet-setup", "confirm", encodeWalletSetup(plan()));
      node("preview").click(); assert(node("status").textContent.includes("復元を停止"), "uncertain writer quarantined");
      settle(); await pause();
      assert(node("status").textContent.includes("復元を停止"), "late completion cannot claim success");
      assert(node("apply").disabled, "late completion cannot reauthorize");
    } finally { settle(); panel.dispose(); parent.remove(); }
  });
  for (const outcome of ["false", "then", "cancel", "dispose"]) {
    test(`restore-confirmation: settings download ${outcome} never reports successful start`, async () => {
      const parent = host(); let panel, reads = 0;
      panel = mountWalletSetupPanel({ document, parent, readFields: () => plan().entries, applyPlan() {},
        download() {
          if (outcome === "cancel") parent.querySelector(".wallet-setup-cancel").click();
          if (outcome === "dispose") panel.dispose();
          if (outcome === "then") return { get then() { reads++; return async () => { throw Error("synthetic async callback"); }; } };
          return outcome !== "false";
        } });
      try {
        const status = parent.querySelector(".wallet-setup-status");
        parent.querySelector(".wallet-setup-save").click(); await pause();
        assert(!status.textContent.includes("開始しました"), "no successful download marker");
        if (outcome === "then") assert(reads === 1, "one captured receipt");
        if (outcome === "dispose") assert(!parent.children.length, "closed panel stays closed");
      } finally { panel.dispose(); parent.remove(); }
    });
  }
  test("restore-confirmation: settings survive native File import into a new panel", async () => {
    const parent = host(); let current = plan().entries, saved;
    let panel = mountWalletSetupPanel({ document, parent, readFields: () => current,
      applyPlan(value) { current = value.entries.map(row => ({ ...row, account: row.account ?? "" })); },
      download({ prepared }) { saved = new File([prepared.text], prepared.filename, { type: prepared.mimeType }); return true; } });
    try {
      parent.querySelector(".wallet-setup-save").click(); assert(saved instanceof File, "native File captured");
      const original = await saved.text(); panel.dispose(); current = fields();
      panel = mountWalletSetupPanel({ document, parent, readFields: () => current,
        applyPlan(value) { current = value.entries.map(row => ({ ...row, account: row.account ?? "" })); } });
      const input = parent.querySelector(".wallet-setup-file"), transfer = new DataTransfer();
      transfer.items.add(saved); input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true }));
      for (let attempt = 0; attempt < 200 && parent.querySelector(".wallet-setup-json").value !== original; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      assert(parent.querySelector(".wallet-setup-json").value === original, "native file decoded unchanged");
      equal(current, fields(), "loading never applies");
      const node = confirm(parent, "wallet-setup", "confirm", original);
      equal(current, plan().entries, "three identities restored after explicit review");
      assert(node("readiness").textContent.includes("3 / 3"), "readback shown");
      assert(node("readiness").textContent.includes("接続未確認"), "saved address is not proof of ownership");
    } finally { panel.dispose(); parent.remove(); }
  });
  for (const failure of ["prepare", "write", "rollback", "late"]) {
    test(`restore-confirmation: workspace ${failure} preserves recovery and avoids false success`, async () => {
      const parent = host(), before = draft({ block: "10" }); let current = clone(before), writes = 0, settle;
      const pending = new Promise(resolve => { settle = resolve; });
      const panel = mountWorkspacePanel({ document, parent, readDraft: () => current,
        prepareWrite: () => failure !== "prepare",
        writeDraft(value) {
          writes++; current = clone(value);
          if (failure === "late") return pending.then(() => { current = clone(value); });
          return failure === "rollback" || (failure === "write" && writes === 1) ? false : undefined;
        } });
      try {
        const node = confirm(parent, "workspace", "confirmed", text({ block: "20" }));
        assert(!node("status").textContent.includes("一括復元しました"), "failed work cannot announce restore");
        if (failure === "prepare") assert(writes === 0, "no writes after preparation failed");
        if (failure === "write") equal(current, before, "synchronous negative receipt rolled back");
        if (["rollback", "late"].includes(failure)) {
          assert(node("status").textContent.length > 0, "recovery instructions visible");
          node("preview").click(); assert(node("apply").disabled, "recovery required prevents another apply");
        }
        settle(); await pause();
        assert(!node("status").textContent.includes("一括復元しました"), "late result cannot revive success");
      } finally { settle(); panel.dispose(); parent.remove(); }
    });
  }
  test("restore-confirmation: browser provider discovery clears before failed removal", async () => {
    const target = new EventTarget(), provider = { request() { throw Error("must not connect"); } };
    const info = { uuid: "12345678-1234-1234-1234-123456789abc", name: "Synthetic", rdns: "test.wallet" };
    target.addEventListener(REQUEST_EVENT, () => target.dispatchEvent(new CustomEvent(ANNOUNCE_EVENT, { detail: { info, provider } })));
    const remove = target.removeEventListener.bind(target);
    let retained;
    const add = target.addEventListener.bind(target);
    target.addEventListener = (type, listener) => { retained = listener; add(type, listener); };
    target.removeEventListener = () => { throw Error("synthetic cleanup failure"); };
    const registry = createWalletProviderRegistry({ eventTarget: target });
    try {
      assert(registry.list().length === 1, "synthetic announcement received"); registry.dispose();
      equal(registry.list(), [], "provider references cleared"); assert(registry.getProvider(info.uuid) === null, "cannot select disposed provider");
      retained({ detail: { info, provider } }); equal(registry.list(), [], "late event cannot restore provider");
    } finally { remove(ANNOUNCE_EVENT, retained); registry.dispose(); }
  });
  for (const action of ["save", "save-summary", "recovery"]) {
    for (const receipt of ["false", "async-then"]) {
      test(`restore-confirmation: workspace ${action} failed delivery retains a native retry copy (${receipt})`, async () => {
        const parent = host(), original = draft({ block: "10" }); let current = clone(original), accepted = false;
        const downloads = [];
        const panel = mountWorkspacePanel({ document, parent, readDraft: () => current,
          writeDraft(value) { current = clone(value); }, download({ prepared }) {
            downloads.push(new Blob([prepared.text], { type: prepared.mimeType }));
            if (accepted) return true;
            return receipt === "false" ? false : { async then() { throw Error("synthetic receipt failure"); } };
          } });
        const node = name => parent.querySelector(".workspace-" + name);
        async function click() {
          node(action).click();
          for (let i = 0; i < 200 && parent.querySelector(".workspace-panel").getAttribute("aria-busy") === "true"; i++) await new Promise(resolve => setTimeout(resolve, 10));
          await pause();
        }
        try {
          if (action === "recovery") confirm(parent, "workspace", "confirmed", text({ block: "20" }));
          const before = clone(current); await click();
          assert(node("status").textContent.includes("開始できません"), "negative delivery is shown");
          assert(!node("backup-status").textContent.includes("開始済み"), "no successful backup marker");
          equal(current, before, "current data retained");
          accepted = true; await click(); assert(downloads.length === 2, "explicit retry offered one further file");
          const first = await downloads[0].text(), second = await downloads[1].text();
          assert(first === second, "retry content unchanged");
          if (action === "recovery") equal(JSON.parse(second).entries, original, "native recovery Blob contains original data");
        } finally { panel.dispose(); parent.remove(); }
      });
    }
  }
}
