import { mountTransferPanel } from "/examples/transfer-panel.js";
import { readTransferSnapshot } from "/src/transfer-reader.js";
import { ZERO_ADDRESS } from "/src/transfer-codec.js";
import { ACCOUNT, OTHER, THIRD, context, event, providerFixture } from "/test/helpers/transfer-fixtures.js";

const picker = document.querySelector("#agent");
const parent = document.querySelector("#transfer-demo");
let mounted;
let fixture;
function start() {
  mounted?.dispose();
  fixture?.session.disconnect();
  const selected = context(picker.value, 84532);
  const rows = [
    event({ amountBaseUnits: "125000000000000000000" }),
    event({ from: ACCOUNT, to: OTHER, amountBaseUnits: "2000000000000000000" }, 1),
    event({ from: ACCOUNT, to: ACCOUNT, amountBaseUnits: "1000000000000000000" }, 2),
    event({ from: THIRD, amountBaseUnits: "1234567890123456789" }, 3),
    event({ from: ZERO_ADDRESS, amountBaseUnits: "10000000000000000000" }, 4),
    event({ from: ACCOUNT, to: ZERO_ADDRESS, amountBaseUnits: "500000000000000000" }, 5),
  ];
  fixture = providerFixture({ selected, rows, siteOrigin: location.origin });
  const active = fixture;
  mounted = mountTransferPanel({ document, parent, getContext: () => selected,
    read: async (request, options) => {
      if (!active.session.state.connected) await active.session.connect();
      return readTransferSnapshot(active.session, request, options);
    },
  });
}
picker.addEventListener("change", start);
start();
window.addEventListener("pagehide", () => { mounted?.dispose(); fixture?.session.disconnect(); });
