import { TAB_GUARD_BUDGET, TAB_GUARD_TTL, TAB_GUARD_RECEIPTS,
  tabGuardFail, tabGuardCode, tabGuardTime, randomTabId, validateTabSignal,
  createStopSignal, createStopReceipt, tabSignalFresh, createTabReplayWindow } from "./tab-guard-protocol.js";

/** Stop-only coordination. Resume stays local; received stops are never relayed. */
export function createTabGuard({ transport, onStop, onChange = () => {}, now = Date.now,
  crypto = globalThis.crypto, schedule = setTimeout, unschedule = clearTimeout,
  receiptMs = 2000 } = {}) {
  if (!transport || ![transport.subscribe, transport.post, transport.close, onStop,
    onChange, now, schedule, unschedule].every(value => typeof value === "function") ||
    !Number.isSafeInteger(receiptMs) || receiptMs < 1 || receiptMs > 5000) tabGuardFail("TAB_CONFIG");
  let phase = "idle", errorCode = null, disposed = false, available = false;
  let source = null, started = false, active = false, failing = false, lastTime = 0, resumeFloor = 0;
  let pending = null, timer = null, generation = 0, accepted = 0, sent = 0, ignored = 0;
  let receiptCount = 0, windowStart = 0, budget = 0;
  const replay = createTabReplayWindow();
  const count = value => Math.min(Number.MAX_SAFE_INTEGER, value + 1);
  function state() {
    return Object.freeze({ phase, errorCode, available, disposed, pending: !!pending,
      sent, received: accepted, ignored, receiptCount, maxReceipts: TAB_GUARD_RECEIPTS });
  }
  function emit() { try { onChange(state()); } catch {} }
  function clock() {
    let value;
    try { value = tabGuardTime(now()); } catch { tabGuardFail("TAB_CLOCK"); }
    if (value < lastTime) tabGuardFail("TAB_CLOCK");
    lastTime = value;
    return value;
  }
  function clearPending() {
    generation++;
    if (timer !== null) { try { unschedule(timer); } catch {} }
    timer = null;
    pending = null;
  }
  function stopLocal(reason) {
    try {
      const outcome = onStop(reason);
      if (outcome && typeof outcome.then === "function") {
        Promise.resolve(outcome).catch(() => {});
        return false;
      }
      return outcome === true;
    } catch { return false; }
  }
  function fail(code, protect = true) {
    if (disposed || failing || phase === "error") return;
    failing = true;
    available = false;
    clearPending();
    replay.clear();
    try { transport.close(); } catch {}
    errorCode = code;
    phase = "error";
    if (protect) stopLocal("channel-error");
    if (!disposed) emit();
    failing = false;
  }
  function ignore() { ignored = count(ignored); }
  function post(signal) {
    const outcome = transport.post(signal);
    if (outcome && typeof outcome.then === "function") {
      Promise.resolve(outcome).catch(() => {});
      tabGuardFail("TAB_TRANSPORT");
    }
    if (outcome !== true) tabGuardFail("TAB_TRANSPORT");
  }
  function armReceipt(ticket, delay) {
    let scheduling = true;
    const handle = schedule(() => {
      if (disposed || generation !== ticket || !pending) return;
      if (scheduling) { fail("TAB_CONFIG"); return; }
      timer = null;
      try {
        const remaining = pending.deadline - clock();
        if (remaining > 0) { armReceipt(ticket, remaining); return; }
        clearPending();
        phase = "complete";
        emit();
      } catch (error) { fail(tabGuardCode(error)); }
    }, delay);
    scheduling = false;
    if (disposed || !pending || generation !== ticket) {
      try { unschedule(handle); } catch {}
    } else timer = handle;
  }
  function receive(input) {
    if (disposed || !available || active) return;
    active = true;
    try {
      const time = clock();
      if (time - windowStart >= TAB_GUARD_TTL) { windowStart = time; budget = 0; }
      if (++budget > TAB_GUARD_BUDGET) { fail("TAB_FLOOD"); return; }
      let signal;
      try { signal = validateTabSignal(input); }
      catch { ignore(); return; }
      if (signal.source === source || !tabSignalFresh(signal, time)) { ignore(); return; }
      if (signal.kind === "receipt") {
        if (!pending || signal.target !== source || signal.id !== pending.signal.id ||
            signal.issuedAt !== pending.signal.issuedAt || time >= pending.deadline ||
            pending.receipts.has(signal.source)) { ignore(); return; }
        if (pending.receipts.size >= TAB_GUARD_RECEIPTS) { ignore(); return; }
        pending.receipts.add(signal.source);
        receiptCount = pending.receipts.size;
        emit();
        return;
      }
      if (signal.issuedAt <= resumeFloor || !replay.accept(signal, time)) { ignore(); return; }
      if (!stopLocal("peer-stop")) { fail("TAB_CLEANUP", false); return; }
      if (disposed || !available) return;
      accepted = count(accepted);
      post(createStopReceipt(signal, source));
      if (disposed || !available) return;
      if (!pending) phase = "received";
      emit();
    } catch (error) { fail(tabGuardCode(error)); }
    finally { active = false; }
  }
  function start() {
    if (disposed || started || active) return false;
    started = true;
    active = true;
    try {
      clock();
      source = randomTabId(crypto);
      // Opening a channel never sends a message or performs a wallet action.
      available = true;
      const subscribed = transport.subscribe(receive, () => fail("TAB_TRANSPORT"));
      if (subscribed && typeof subscribed.then === "function") {
        Promise.resolve(subscribed).catch(() => {});
        tabGuardFail("TAB_TRANSPORT");
      }
      if (subscribed !== true) tabGuardFail("TAB_TRANSPORT");
      if (disposed || !available) return false;
      phase = "ready";
      emit();
      return !disposed && available;
    } catch (error) {
      fail(tabGuardCode(error), false);
      return false;
    } finally { active = false; }
  }
  function stop() {
    if (disposed || active || pending) return false;
    active = true;
    try {
      // The current screen stops first, even if delivery is unavailable.
      if (!stopLocal("broadcast-stop")) { fail("TAB_CLEANUP", false); return false; }
      if (disposed) return false;
      if (!available) { errorCode ||= "TAB_UNAVAILABLE"; phase = "error"; emit(); return false; }
      const time = clock();
      const signal = createStopSignal(source, randomTabId(crypto), time);
      clearPending();
      receiptCount = 0;
      pending = { signal, deadline: time + receiptMs, receipts: new Set() };
      const ticket = generation;
      phase = "waiting";
      errorCode = null;
      // A receipt is counted only after this explicit request, within its short window.
      armReceipt(ticket, receiptMs);
      if (disposed || !available || !pending) return false;
      post(signal);
      if (disposed || !available) return false;
      sent = count(sent);
      emit();
      return true;
    } catch (error) { fail(tabGuardCode(error)); return false; }
    finally { active = false; }
  }
  function noteResume() {
    if (disposed || active) return false;
    active = true;
    try {
      resumeFloor = clock();
      clearPending();
      receiptCount = 0;
      // Do not clear the replay cache: queued duplicates must stay rejected.
      if (available) { phase = "ready"; errorCode = null; }
      emit();
      return !disposed;
    } catch (error) { fail(tabGuardCode(error)); return false; }
    finally { active = false; }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    available = false;
    clearPending();
    replay.clear();
    source = null;
    try { transport.close(); } catch {}
    phase = "disposed";
    errorCode = null;
    emit();
  }
  return Object.freeze({ state, start, stop, noteResume, dispose });
}
