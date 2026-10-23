import { mountTransferVaultPanel } from "/examples/transfer-vault-panel.js";
import { createVaultStorage } from "/src/transfer-vault-storage.js";
import { vaultBundle } from "/src/transfer-vault-model.js";
import { addTransferArchiveRecord } from "/src/transfer-archive.js";
import { ZERO_ADDRESS } from "/src/transfer-codec.js";
import { context, snapshot, event, hash, ACCOUNT, OTHER, THIRD } from "/test/helpers/transfer-fixtures.js";

const agents = ["DAT", "EMA", "CAWELON"];
function source() {
  return vaultBundle(agents.map((agent, index) => {
    const account = [ACCOUNT, OTHER, THIRD][index];
    const partner = account === ACCOUNT ? OTHER : ACCOUNT;
    const selected = context(agent, 84532, account);
    const rows = [
      event({ from: partner, to: account, amountBaseUnits: String(125n * 10n ** 18n) }, 0),
      event({ from: account, to: partner, amountBaseUnits: String(BigInt(index + 2) * 10n ** 18n) }, 1),
      event({ from: ZERO_ADDRESS, to: account, amountBaseUnits: String(10n * 10n ** 18n) }, 2),
      event({ from: account, to: account, amountBaseUnits: "1000000000000000001" }, 3),
    ];
    const first = snapshot({ events: rows }, selected);
    const later = snapshot({ range: { fromBlock: "50", toBlock: "60" }, fromBlockHash: hash(50), toBlockHash: hash(60), events: [] }, selected);
    return addTransferArchiveRecord(addTransferArchiveRecord(null, first), later);
  }));
}

function start() {
  return mountTransferVaultPanel({ document, parent: document.querySelector("#vault-demo"), readCards: source,
    stageArchive: async () => false,
    storage: createVaultStorage({ name: "threecore-transfer-vault-preview-only-v1" }),
  });
}
let app = start();
window.addEventListener("pagehide", () => { app?.dispose(); app = null; });
window.addEventListener("pageshow", () => { if (!app) app = start(); });
