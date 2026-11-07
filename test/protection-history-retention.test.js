import test from "node:test";
import assert from "node:assert/strict";
import { mountSecurityPanel } from "../examples/security-panel.js";
import { mountPortfolioPanel } from "../examples/portfolio-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { fakeClock } from "./helpers/security-fixtures.js";
import { observation } from "./helpers/history-fixtures.js";

const settle = () => new Promise(resolve => setImmediate(resolve));

// Compose the real protection and portfolio panels using the same invalidation
// boundary used after disconnection in wallet-demo. No provider or storage IO.
for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const reason of ["idle", "hidden", "manual"]) {
    test(`${agent}: ${reason} stop preserves exportable history without automatic rereads`, async () => {
      const document = Object.assign(new EventTarget(), {
        createElement: tag => new Element(tag), visibilityState: "visible",
      });
      const eventTarget = new EventTarget(), parent = new Element("div");
      const card = new Element("article"); card.dataset = { agent };
      const clock = fakeClock(); let reads = 0;
      const portfolio = mountPortfolioPanel({ document, card,
        getContext: () => ({ agent, chainId: 8453 }),
        read: async () => { reads++; return observation("42", { agent, chainId: 8453 }); },
      });
      const security = mountSecurityPanel({ document, parent, eventTarget,
        lockOptions: clock.options, tabGuardOptions: { transport: null },
        onLock: () => portfolio.invalidate(),
      });
      const q = name => parent.find("security-" + name);
      try {
        assert.equal(q("retention").hidden, true);
        card.find("portfolio-read").click(); await settle();
        card.find("history-add-current").click();
        const before = portfolio.exportHistory();
        assert.equal(JSON.parse(before).reports.length, 1);
        if (reason === "idle") clock.advance(300_000);
        else if (reason === "hidden") {
          document.visibilityState = "hidden";
          document.dispatchEvent(new Event("visibilitychange"));
        } else q("stop").click();
        assert.equal(security.state().reason, reason);
        assert.equal(security.check(), false);
        assert.equal(q("retention").hidden, false);
        assert.match(q("retention").textContent, /ファイルへの保存完了を意味しません/);
        assert.equal(portfolio.exportHistory(), before);
        card.find("history-export").click();
        assert.equal(card.find("history-json").value, before);
        document.visibilityState = "visible";
        document.dispatchEvent(new Event("visibilitychange"));
        q("resume").click();
        assert.equal(security.check(), true);
        assert.equal(q("retention").hidden, true);
        assert.equal(portfolio.exportHistory(), before);
        assert.equal(reads, 1);
      } finally { security.dispose(); portfolio.dispose(); }
    });
  }
}
