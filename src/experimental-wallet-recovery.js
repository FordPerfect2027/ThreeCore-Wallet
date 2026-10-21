// Experimental recovery for a pinned, synthetic-only connector store. No RPC,
// permission request, connection, wallet uninstall or permission revocation.
export function createWalletRecoveryController(registry, access, timeoutMs = 3000) {
  let sequence = 0, review, selected, state = { status: "closed", groups: [] };
  const listeners = new Set();
  const emit = (status, message, groups = []) => {
    state = { status, message, groups, selected };
    for (const listener of listeners) listener(state);
  };
  const stamp = rows => rows.map(c => [c.uid, c.name, c.getProvider, c.connect]);
  const sameRows = (rows, stamps) => {
    const now = access.rows();
    return rows.length === now.length && rows.every((row, i) => row === now[i] &&
      stamp([row])[0].every((value, k) => value === stamps[i][k]));
  };
  async function boundedScan() {
    let timer;
    try {
      return await Promise.race([registry.reviewProviders(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("Wallet review timed out. Try again.")), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  const clear = () => { sequence++; review = undefined; selected = undefined; };
  function changed() {
    clear();
    if (state.status !== "closed") emit("changed", "Wallet entries changed. Review them again before choosing.");
  }
  return Object.freeze({
    subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
    changed,
    close() { clear(); emit("closed", ""); },
    async scan() {
      clear(); const ticket = sequence, rows = [...access.rows()], stamps = stamp(rows);
      emit("loading", "Checking wallet entries…");
      try {
        const entries = await boundedScan();
        if (ticket !== sequence) return;
        if (!sameRows(rows, stamps) || entries.length !== rows.length - access.configuredCount ||
            entries.some((entry, i) => entry.uid !== rows[i + access.configuredCount].uid)) {
          throw Error("Wallet entries changed. Review them again.");
        }
        const providers = new Map();
        for (const entry of entries) {
          const group = providers.get(entry.provider) ?? [];
          group.push(entry); providers.set(entry.provider, group);
        }
        const groups = [...providers.values()].filter(group => group.length > 1);
        review = { rows, stamps, entries, groups };
        emit("ready", groups.length ? "Choose the entry to keep. Only its duplicate entries will be removed." :
          "No duplicate connections found. Wallets with the same name remain separate.",
        groups.map(group => group.map(({ uid, id, label }) => ({ uid, id, label }))));
      } catch (error) { if (ticket === sequence) { review = undefined; emit("error", error.message); } }
    },
    select(uid) {
      if (state.status !== "ready" || !review?.groups.some(g => g.some(e => e.uid === uid))) return false;
      selected = uid;
      const entry = review.entries.find(e => e.uid === uid);
      emit("ready", `Choice ${entry.id} selected to keep. Removing duplicates will not connect a wallet.`, state.groups);
      return true;
    },
    async apply() {
      if (state.status !== "ready" || !selected || !review) return false;
      const ticket = sequence, pending = review, keep = selected;
      emit("applying", "Checking your selection before removing duplicates…");
      try {
        const entries = await boundedScan();
        if (ticket !== sequence) return false;
        if (!sameRows(pending.rows, pending.stamps) || entries.length !== pending.entries.length || entries.some((e, i) =>
          e.uid !== pending.entries[i].uid || e.label !== pending.entries[i].label || e.provider !== pending.entries[i].provider)) {
          throw Error("Wallet entries changed. Review them again.");
        }
        const group = pending.groups.find(g => g.some(e => e.uid === keep));
        const remove = new Set(group.filter(e => e.uid !== keep).map(e => e.uid));
        const next = pending.rows.filter(c => !remove.has(c.uid));
        // No await between final verification, invalidation and store update.
        // Even the retained choice must be freshly selected after cleanup.
        registry.invalidateChoices();
        try { access.replace(next); }
        catch (error) { clear(); emit("error", "The wallet list could not be updated. Review it again."); return false; }
        clear();
        emit("done", "Duplicates removed. Choose a wallet in the wallet list to reconnect. No wallet was connected by this action.");
        return true;
      } catch (error) {
        if (ticket === sequence) { clear(); emit("error", error.message); }
        return false;
      }
    },
  });
}

export function mountWalletRecoveryPanel(document, controller) {
  const panel = document.createElement("section");
  panel.id = "threecore-wallet-recovery";
  panel.setAttribute("aria-label", "Wallet entry review — mock experiment");
  panel.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:380px;max-height:70vh;overflow:auto;background:#172033;color:#fff;border:2px solid #8ba8d5;border-radius:12px;padding:16px;font:14px/1.5 system-ui;box-shadow:0 4px 24px #0008";
  const heading = document.createElement("h2"); heading.textContent = "Wallet entry review · Mock experiment";
  const help = document.createElement("p");
  help.textContent = "Names are unverified. Matching names alone are never merged. This action removes duplicate list entries; it does not revoke wallet permissions.";
  const status = document.createElement("p"); status.tabIndex = -1; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const groups = document.createElement("div");
  const button = (label, action) => {
    const node = document.createElement("button"); node.type = "button"; node.textContent = label;
    node.style.cssText = "display:block;margin:8px 0;padding:8px 12px;border:1px solid #a4b8db;border-radius:6px;background:#e4ecfb;color:#172033;cursor:pointer";
    node.addEventListener("click", action); return node;
  };
  const open = button("Review wallet entries", async () => { await controller.scan(); if (panel.dataset.status !== "closed") status.focus(); });
  const apply = button("Remove duplicate entries", async () => { await controller.apply(); if (panel.dataset.status !== "closed") status.focus(); });
  const close = button("Close wallet review", () => { controller.close(); open.focus(); });
  panel.append(heading, help, open, status, groups, apply, close);
  document.body.append(panel);
  controller.subscribe(state => {
    panel.dataset.status = state.status;
    status.textContent = state.message ?? "";
    const busy = ["loading", "applying"].includes(state.status);
    open.disabled = busy;
    apply.hidden = state.status !== "ready" || !state.groups.length;
    apply.disabled = busy || !state.selected;
    close.hidden = state.status === "closed";
    help.hidden = state.status === "closed";
    groups.replaceChildren();
    for (const group of state.groups) {
      const field = document.createElement("fieldset"), legend = document.createElement("legend");
      legend.textContent = "Entries for the same wallet connection"; field.append(legend);
      for (const entry of group) {
        const label = document.createElement("p"); label.textContent = entry.label;
        const choice = button(`Keep choice ${entry.id}`, () => { if (controller.select(entry.uid)) apply.focus(); });
        choice.setAttribute("aria-pressed", String(state.selected === entry.uid));
        if (state.selected === entry.uid) {
          choice.style.background = "#b4f5dc"; choice.style.border = "2px solid #44cda0"; choice.style.fontWeight = "700";
        }
        choice.disabled = busy; field.append(label, choice);
      }
      groups.append(field);
    }
  });
  return panel;
}
