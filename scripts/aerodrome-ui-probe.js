#!/usr/bin/env node
// Official Aerodrome UI diagnostic in a launcher-owned, disposable browser.
// No keys/extensions exist. The synthetic provider rejects every signature.
import { makeAerodromeMockWalletSource, SYNTHETIC_WALLET_NAME } from "../src/aerodrome-mock-wallet.js";
import { summarizeAerodromeProbe, summarizeDiscoveryTrace, selectMockWalletLabel } from "../src/external-dapp-report.js";
import { inspectPublicAppScripts } from "./inspect-dapp-discovery.js";
import { parseProbeOptions } from "./aerodrome-probe-options.js";
import { EXPERIMENT_URL, fulfillConnectorExperiment } from "./aerodrome-connector-experiment.js";
import { summarizeMockScenario } from "../src/aerodrome-scenarios.js";
import { makeWalletChoiceRegistrySource } from "../src/experimental-wallet-choices.js";
import { summarizeWalletChoiceExperiment } from "../src/aerodrome-choice-report.js";
import { summarizeWalletLifecycle } from "../src/aerodrome-lifecycle-report.js";
import { summarizeWalletRecovery } from "../src/aerodrome-recovery-report.js";

const args = process.argv.slice(2);
const { mockMode, diagnose, discovery, experiment, choiceExperiment, scenario, lifecycle, recovery } = parseProbeOptions(args);
const port = Number(process.env.THREECORE_ISOLATED_EDGE_CDP_PORT);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
  throw Error("Launch through the isolated Edge runner; no existing browsers may be attached");
}
const cdpBase = "http://127.0.0.1:" + port;
const response = await fetch(cdpBase + "/json/list", { signal: AbortSignal.timeout(5000) });
if (!response.ok) throw Error("Isolated browser refused local access");
// Require the fresh blank page supplied by our launcher, not a logged-in tab.
const target = (await response.json()).find(t => t.type === "page" && t.url === "about:blank");
if (!target?.webSocketDebuggerUrl?.startsWith("ws://127.0.0.1:" + port + "/")) throw Error("No isolated blank browser target");
const ws = new WebSocket(target.webSocketDebuggerUrl);
const inflight = new Map();
let experimentError;
let nextId = 0;
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error("CDP open timeout")), 5000);
  ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
  ws.addEventListener("error", () => { clearTimeout(timer); reject(Error("CDP connection failed")); }, { once: true });
});
ws.addEventListener("message", event => {
  let reply;
  try { reply = JSON.parse(event.data); } catch { return; }
  if (reply.method === "Fetch.requestPaused") {
    fulfillConnectorExperiment(reply.params, cmd, record.connectorExperiment).catch(async error => {
      experimentError = error;
      record.connectorExperiment.status = "refused";
      record.connectorExperiment.error = error.message;
      await cmd("Fetch.failRequest", { requestId: reply.params.requestId, errorReason: "Aborted" }).catch(() => {});
    });
    return;
  }
  const task = inflight.get(reply.id);
  if (!task) return;
  inflight.delete(reply.id);
  clearTimeout(task.timer);
  if (reply.error) task.reject(Error(reply.error.message));
  else task.resolve(reply.result);
});
function cmd(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { inflight.delete(id); reject(Error("CDP timeout: " + method)); }, 10000);
    inflight.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await cmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
  return result.result?.value ?? null;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function snapshot() {
  return evaluate(`(() => {
    const mock = window.__threecoreWalletSimulation;
    const secondary = window.__threecoreSecondarySimulation;
    const added = window.__threecoreAddedSimulation;
    return { url: location.origin + location.pathname, title: document.title,
      text: (document.body?.innerText || "").slice(0, 5000),
      buttons: [...document.querySelectorAll("button")].map(b => ({
        text: (b.innerText || b.getAttribute("aria-label") || "").trim().slice(0, 120),
        disabled: b.disabled })).filter(b => b.text).slice(0, 60),
      simulationActive: !!mock, discovery: mock?.discovery,
      hasLegacyProvider: !!window.ethereum,
      methods: mock?.observed || [], rejections: mock?.rejections || [],
      emitted: mock?.emitted || [], accounts: mock?.accounts || [],
      trace: mock?.trace || [], announcementsEnabled: mock?.announcementsEnabled, mockName: mock?.name,
      choices: window.__threecoreExperimentalChoices?.choices() || [],
      recoveryUi: (() => { const p = document.getElementById("threecore-wallet-recovery");
        return p ? { status: p.dataset.status, text: p.innerText,
          buttons: [...p.querySelectorAll("button")].filter(b => !b.hidden && b.getClientRects().length).map(b => ({ text: b.innerText, disabled: b.disabled, selected: b.getAttribute("aria-pressed") })) } : null; })(),
      secondary: secondary ? { name: secondary.name, uuid: secondary.uuid,
        methods: [...secondary.observed], accounts: secondary.accounts,
        rejections: [...secondary.rejections], trace: [...secondary.trace], emitted: [...secondary.emitted] } : null,
      added: added ? { name: added.name, uuid: added.uuid, methods: [...added.observed], accounts: added.accounts,
        rejections: [...added.rejections], emitted: [...added.emitted], announcementsEnabled: added.announcementsEnabled } : null };
  })()`);
}
async function until(predicate, timeoutMs) {
  const started = Date.now();
  let state;
  do {
    state = await snapshot();
    if (experimentError) throw experimentError;
    if (predicate(state)) return state;
    await pause(250);
  } while (Date.now() - started < timeoutMs);
  return state;
}
async function clickKnown(labels) {
  const result = await evaluate(`(() => {
    if (location.origin !== "https://aerodrome.finance" || !window.__threecoreWalletSimulation) return false;
    const labels = ${JSON.stringify(labels)};
    for (const label of labels) {
      const buttons = [...document.querySelectorAll("button")].filter(b => !b.disabled && !b.hidden && b.getClientRects().length && (b.innerText || "").trim() === label);
      if (buttons.length > 1) return false;
      if (buttons.length === 1) {
        const button = buttons[0];
        if (${recovery} && button.closest("#threecore-wallet-recovery")) {
          button.scrollIntoView({ block: "nearest" });
          const r = button.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
          const hit = document.elementFromPoint(x, y);
          return hit && (hit === button || button.contains(hit)) ? { x, y } : false;
        }
        button.click(); return true;
      }
    }
    return false;
  })()`);
  if (result && typeof result === "object") {
    await cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: result.x, y: result.y });
    await cmd("Input.dispatchMouseEvent", { type: "mousePressed", x: result.x, y: result.y, button: "left", clickCount: 1 });
    await cmd("Input.dispatchMouseEvent", { type: "mouseReleased", x: result.x, y: result.y, button: "left", clickCount: 1 });
    return true;
  }
  return result === true;
}
const record = { observedAtUtc: new Date().toISOString(), officialOrigin: "https://aerodrome.finance",
  profile: "temporary-isolated-Chromium", mockMode, discovery, scenario, lifecycleSimulation: lifecycle, recoveryUiExperiment: recovery,
  pageVariant: choiceExperiment ? "local-wallet-choice-experiment" : experiment ? "local-connector-list-experiment" : "unmodified-official" };
async function clickWallet(secondary = false) {
  let label;
  if (choiceExperiment) {
    const slot = secondary === "added" ? "__threecoreAddedSimulation" : secondary ? "__threecoreSecondarySimulation" : "__threecoreWalletSimulation";
    label = await evaluate(`window.__threecoreExperimentalChoices.labelForProvider(window.${slot}.provider)`);
    if (!label) return false;
    const matches = (await snapshot()).choices.filter(c => c.label === label);
    if (matches.length !== 1) return false;
    const key = secondary === "added" ? "addedChoice" : secondary ? "secondaryChoice" : "primaryChoice";
    if (record[key] && (record[key].uid !== matches[0].uid || record[key].label !== label)) throw Error("Selection identity changed");
    record[key] = matches[0];
  } else label = selectMockWalletLabel(await snapshot(), discovery);
  if (!label) return false;
  const clicked = await clickKnown([label]);
  if (clicked && !secondary) record.selectedWalletLabel = label;
  return clicked;
}
try {
  await cmd("Page.enable");
  await cmd("Runtime.enable");
  if (recovery) await cmd("Emulation.setDeviceMetricsOverride", { width: 1280, height: 960, deviceScaleFactor: 1, mobile: false });
  if (experiment) {
    record.connectorExperiment = { status: "pending", scope: "disposable-browser-response-only", kind: choiceExperiment ? "wallet-choice" : "connector-list" };
    await cmd("Network.enable");
    await cmd("Network.setCacheDisabled", { cacheDisabled: true });
    await cmd("Network.setBypassServiceWorker", { bypass: true });
    await cmd("Fetch.enable", { patterns: [{ urlPattern: EXPERIMENT_URL, requestStage: "Response" }] });
  }
  if (mockMode) await cmd("Page.addScriptToEvaluateOnNewDocument", {
    source: makeAerodromeMockWalletSource(undefined, { discovery, scenario, lifecycle }) + (choiceExperiment ? "\n" + makeWalletChoiceRegistrySource({ lifecycle, recovery }) : ""),
  });
  await cmd("Page.navigate", { url: "https://aerodrome.finance/dash" });
  record.before = await until(s => !!selectMockWalletLabel(s, discovery), 35000);
  if (mockMode) {
    if (diagnose) {
      record.earlyUi = record.before;
      await pause(2500);
      record.before = await snapshot();
    }
    if (choiceExperiment) {
      record.beforeChoices = await until(s => s.choices.length === 2, 8000);
      await evaluate(`(() => {
        for (const p of [window.__threecoreWalletSimulation, window.__threecoreSecondarySimulation]) {
          p.markPhase("choice-reannouncement"); for (let i = 0; i < 3; i++) p.reannounce();
        }
      })()`);
      await pause(500); record.before = await snapshot();
    } else if (scenario !== "single") {
      if (["multi-reannounce", "duplicate-name"].includes(scenario)) {
        record.before = await until(s => s.buttons.filter(b => b.text.includes("TEST ONLY") && !b.disabled).length === 2, 8000);
      }
      record.beforeScenario = record.before;
      if (scenario === "delayed") {
        await evaluate(`(() => { const p = window.__threecoreWalletSimulation;
          p.markPhase("scenario-activation"); p.activate(); })()`);
        record.before = await until(s => s.buttons.some(b => b.text === SYNTHETIC_WALLET_NAME), 8000);
      } else if (scenario === "multi-reannounce") {
        await evaluate(`(() => {
          for (const p of [window.__threecoreWalletSimulation, window.__threecoreSecondarySimulation]) {
            p.markPhase("scenario-reannouncement");
            for (let i = 0; i < 3; i++) p.reannounce();
          }
        })()`);
        await pause(500);
        record.before = await snapshot();
      }
    }
    await evaluate(`window.__threecoreWalletSimulation?.markPhase("browser-wallet-click")`);
    record.connectClicked = await clickWallet();
    record.afterConnect = record.connectClicked ? await until(s => s.buttons.some(b => b.text === "Sign-in") ||
      /install.*wallet|wallet.*not.*found/i.test(s.text), 12000) : await snapshot();
    // A generic Connect button may navigate to the dedicated wallet chooser.
    // Follow only the exact synthetic label or the isolated Browser Wallet route.
    if (!record.afterConnect.methods.some(m => ["eth_requestAccounts", "wallet_requestPermissions"].includes(m)) &&
        ["Connect Wallet", "Connect"].includes(record.selectedWalletLabel)) {
      record.browserWalletClicked = await clickWallet();
      record.afterConnect = await until(s => s.buttons.some(b => b.text === "Sign-in") ||
        /install.*wallet|wallet.*not.*found/i.test(s.text), 12000);
    }
    if (scenario !== "duplicate-name" && diagnose && !record.afterConnect.methods.some(m => ["eth_requestAccounts", "wallet_requestPermissions"].includes(m))) {
      record.firstConnectObservation = record.afterConnect;
      await evaluate(`(() => {
        if (location.origin !== "https://aerodrome.finance") return;
        window.__threecoreWalletSimulation?.markPhase("explicit-rediscovery");
        window.dispatchEvent(new Event("eip6963:requestProvider"));
      })()`);
      await pause(1000);
      record.afterRediscovery = await snapshot();
      await evaluate(`window.__threecoreWalletSimulation?.markPhase("second-browser-wallet-click")`);
      record.secondConnectClicked = await clickWallet();
      record.afterConnect = await until(s => s.buttons.some(b => b.text === "Sign-in"), 5000);
    }
    await evaluate(`window.__threecoreWalletSimulation?.markPhase("sign-in-click")`);
    record.signInClicked = scenario === "duplicate-name" && !choiceExperiment ? false : await clickKnown(["Sign-in"]);
    if (record.signInClicked) {
      record.afterSignIn = await until(s => s.rejections.some(r => r.method === "personal_sign"), 10000);
      // Allow the website to render the provider's rejection before recording UI.
      await pause(500);
      record.afterSignIn = await snapshot();
    }
    record.verification = summarizeAerodromeProbe(record);
    if (diagnose) record.discoveryDiagnosis = summarizeDiscoveryTrace(record);
    if (diagnose) {
      const urls = await evaluate(`([...new Set([
        ...[...document.scripts].map(s => s.src),
        ...performance.getEntriesByType("resource").map(r => r.name)
      ])].filter(url => { try { const u = new URL(url); return u.origin === "https://aerodrome.finance" && u.pathname.endsWith(".js"); } catch { return false; } }))`);
      record.publicAppScripts = await inspectPublicAppScripts(urls);
    }
    // This changes only the synthetic provider's memory, never real permissions.
    await evaluate(`(() => {
      if (location.origin === "https://aerodrome.finance") window.__threecoreWalletSimulation?.revokeAccounts();
    })()`);
    record.afterSyntheticRevocation = await until(s => s.accounts.length === 0 &&
      s.buttons.some(b => b.text === "Browser Wallet" || b.text === SYNTHETIC_WALLET_NAME), 5000);
    if (record.verification.signatureBoundaryReached) {
      record.reconnectClicked = await clickWallet();
      record.afterReconnect = await until(s => s.accounts.length === 1 &&
        s.buttons.some(b => b.text === "Sign-in"), 10000);
      record.verification.revocationObserved = record.afterSyntheticRevocation.accounts.length === 0 &&
        record.afterSyntheticRevocation.emitted.some(e => e.event === "accountsChanged" && e.accounts.length === 0) &&
        record.afterSyntheticRevocation.buttons.some(b => b.text === "Browser Wallet" || b.text === SYNTHETIC_WALLET_NAME);
      record.verification.explicitReconnectObserved = record.reconnectClicked &&
        record.afterReconnect.accounts[0] === record.afterSignIn.accounts[0] &&
        record.afterReconnect.buttons.some(b => b.text === "Sign-in") &&
        record.afterReconnect.rejections.length === record.afterSignIn.rejections.length;
      if (!record.verification.revocationObserved || !record.verification.explicitReconnectObserved) process.exitCode = 1;
    }
    if (choiceExperiment && record.verification.signatureBoundaryReached) {
      await evaluate(`window.__threecoreWalletSimulation.revokeAccounts()`);
      record.afterPrimaryDisconnect = await until(s => s.accounts.length === 0 && s.buttons.some(b => b.text === "Browser Wallet"), 5000);
      record.secondaryConnectClicked = await clickWallet(true);
      record.afterSecondaryConnect = await until(s => s.secondary?.accounts.length === 1 && s.buttons.some(b => b.text === "Sign-in"), 10000);
      record.secondarySignInClicked = record.secondaryConnectClicked && await clickKnown(["Sign-in"]);
      record.afterSecondarySignIn = await until(s => s.secondary?.rejections.some(r => r.method === "personal_sign"), 10000);
      await evaluate(`window.__threecoreSecondarySimulation.revokeAccounts()`);
      record.afterBothRevoked = await until(s => s.accounts.length === 0 && s.secondary?.accounts.length === 0 &&
        s.buttons.some(b => b.text === "Browser Wallet"), 5000);
    }
    record.scenarioVerification = choiceExperiment ? summarizeWalletChoiceExperiment(record) : summarizeMockScenario(record);
    if (lifecycle && record.scenarioVerification.verified) {
      const life = record.lifecycle = { scope: "synthetic-framework-list-removal-and-restoration", start: await snapshot() };
      const uid = JSON.stringify(record.primaryChoice.uid);
      await evaluate(`(() => { const h = window.__threecoreExperimentalChoices.lifecycle; h.capture(${uid}); h.remove(${uid}); })()`);
      life.afterRemoval = await until(s => s.choices.length === 1 && !s.buttons.some(b => b.text === record.primaryChoice.label), 8000);
      life.staleRemoved = await evaluate(`window.__threecoreExperimentalChoices.lifecycle.trySavedConnect()`);
      life.afterStaleRemoved = await snapshot();
      await evaluate(`window.__threecoreAddedSimulation.activate()`);
      life.afterAddition = await until(s => s.choices.length === 3 && s.choices.filter(c => c.id > 2).length === 2, 8000);
      const rediscoveredLabel = await evaluate(`window.__threecoreExperimentalChoices.labelForProvider(window.__threecoreWalletSimulation.provider)`);
      const rediscovered = life.afterAddition.choices.filter(c => c.label === rediscoveredLabel);
      if (rediscovered.length !== 1 || rediscovered[0].uid === record.primaryChoice.uid) throw Error("Expected unique rediscovered connector");
      record.rediscoveredChoice = rediscovered[0];
      await evaluate(`window.__threecoreExperimentalChoices.lifecycle.reverse()`);
      life.afterReorder = await until(s => s.choices[0]?.uid !== life.afterAddition.choices[0]?.uid, 8000);
      await evaluate(`window.__threecoreExperimentalChoices.lifecycle.restore(${uid})`);
      life.afterRestore = await until(s => s.choices.length === 4 && s.buttons.some(b => b.text === record.primaryChoice.label), 8000);
      life.staleRestored = await evaluate(`window.__threecoreExperimentalChoices.lifecycle.trySavedConnect()`);
      life.afterStaleRestored = await snapshot();
      // A fresh callback must also refuse two active connectors for one provider.
      await evaluate(`window.__threecoreExperimentalChoices.lifecycle.capture(${uid})`);
      life.ambiguousRestored = await evaluate(`window.__threecoreExperimentalChoices.lifecycle.trySavedConnect()`);
      life.afterAmbiguousRestored = await snapshot();
      if (recovery) {
        const ui = record.recovery = { inputMethod: "CDP mouse on visible recovery-panel controls", before: await snapshot() };
        ui.opened = await clickKnown(["Review wallet entries"]);
        ui.reviewed = await until(s => s.recoveryUi?.status === "ready", 5000);
        ui.selected = await clickKnown([`Keep choice ${record.primaryChoice.id}`]);
        ui.afterSelection = await snapshot();
        const clip = await evaluate(`(() => { const r = document.getElementById("threecore-wallet-recovery").getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 }; })()`);
        ui.panelScreenshotPng = (await cmd("Page.captureScreenshot", { format: "png", clip })).data;
        ui.closed = await clickKnown(["Close wallet review"]);
        ui.afterCancel = await snapshot();
        ui.reopened = await clickKnown(["Review wallet entries"]);
        await until(s => s.recoveryUi?.status === "ready", 5000);
        ui.selectedBeforeChange = await clickKnown([`Keep choice ${record.primaryChoice.id}`]);
        await evaluate(`window.__threecoreExperimentalChoices.lifecycle.reverse()`);
        ui.afterListChange = await until(s => s.recoveryUi?.status === "changed", 5000);
        ui.staleApplyClicked = await clickKnown(["Remove duplicate entries"]);
        ui.refreshed = await clickKnown(["Review wallet entries"]);
        ui.refreshedReview = await until(s => s.recoveryUi?.status === "ready", 5000);
        ui.reselected = await clickKnown([`Keep choice ${record.primaryChoice.id}`]);
        ui.applied = await clickKnown(["Remove duplicate entries"]);
        ui.afterApply = await until(s => s.recoveryUi?.status === "done" && s.choices.length === 3, 5000);
        ui.repeatApplyClicked = await clickKnown(["Remove duplicate entries"]);
        ui.oldCallback = await evaluate(`window.__threecoreExperimentalChoices.lifecycle.trySavedConnect()`);
        ui.afterOldCallback = await snapshot();
        ui.reviewAfterApply = await clickKnown(["Review wallet entries"]);
        ui.noDuplicates = await until(s => s.recoveryUi?.status === "ready", 5000);
        ui.finalClose = await clickKnown(["Close wallet review"]);
      } else {
        await evaluate(`window.__threecoreExperimentalChoices.lifecycle.remove(${JSON.stringify(record.rediscoveredChoice.uid)})`);
      }
      life.afterDeduplication = await until(s => s.choices.length === 3 && !s.buttons.some(b => b.text === record.rediscoveredChoice.label), 8000);
      life.primaryClicked = await clickWallet();
      life.afterPrimaryConnect = await until(s => s.accounts.length === 1 && s.buttons.some(b => b.text === "Sign-in"), 10000);
      // Removing an already connected choice is not wallet permission revocation.
      await evaluate(`window.__threecoreExperimentalChoices.lifecycle.remove(${uid})`);
      life.afterConnectedRemoval = await until(s => !s.choices.some(c => c.uid === record.primaryChoice.uid), 5000);
      await evaluate(`window.__threecoreWalletSimulation.revokeAccounts()`);
      life.afterPrimaryRevocation = await until(s => s.accounts.length === 0 && s.buttons.some(b => b.text === "Browser Wallet"), 5000);
      life.addedClicked = await clickWallet("added");
      life.afterAddedConnect = await until(s => s.added?.accounts.length === 1 && s.buttons.some(b => b.text === "Sign-in"), 10000);
      life.addedSignInClicked = life.addedClicked && await clickKnown(["Sign-in"]);
      life.afterAddedSignIn = await until(s => s.added?.rejections.some(r => r.method === "personal_sign" && r.code === 4001), 10000);
      await evaluate(`window.__threecoreAddedSimulation.revokeAccounts()`);
      life.final = await until(s => s.accounts.length === 0 && s.secondary?.accounts.length === 0 && s.added?.accounts.length === 0 &&
        s.buttons.some(b => b.text === "Browser Wallet"), 5000);
      record.lifecycleVerification = summarizeWalletLifecycle(record);
      if (!record.lifecycleVerification.verified) process.exitCode = 1;
      if (recovery) {
        record.recoveryVerification = summarizeWalletRecovery(record);
        if (!record.recoveryVerification.verified) process.exitCode = 1;
      }
    } else if (lifecycle) process.exitCode = 1;
    if (scenario === "duplicate-name" && !choiceExperiment) {
      record.verification.diagnosticCompleted = record.scenarioVerification.verified;
      record.verification.outcome = record.scenarioVerification.verified ?
        "ambiguous-synthetic-wallet-selection-refused" : "incomplete-or-unexpected-flow";
    }
    if (!record.verification.diagnosticCompleted || !record.scenarioVerification.verified) process.exitCode = 1;
  } else {
    record.verification = { siteUiLoaded: record.before.url.startsWith("https://aerodrome.finance/") && record.before.buttons.length > 0,
      completedSignIn: false, realWalletUsed: false };
    if (!record.verification.siteUiLoaded) process.exitCode = 1;
  }
} catch (error) {
  record.error = error.message;
  process.exitCode = 1;
} finally {
  ws.close();
  process.stdout.write(JSON.stringify(record, null, 2) + "\n");
}
