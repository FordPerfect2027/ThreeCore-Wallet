import { TAB_GUARD_CHANNEL, validateTabSignal, tabGuardFail, TabGuardError } from "./tab-guard-protocol.js";

/** BroadcastChannel only. No HTTP, storage events, workers or persistent fallback. */
export function createBrowserTabTransport({ host, name = TAB_GUARD_CHANNEL } = {}) {
  if (typeof name !== "string" || !/^threecore-[a-z0-9-]{1,100}$/.test(name)) tabGuardFail("TAB_CONFIG");
  let channel = null, send = null, remove = null, end = null;
  let listener = null, fault = null, closed = false;
  const message = event => {
    if (closed || !listener) return;
    let data;
    try { data = event.data; }
    catch { fault?.(); return; }
    listener(data);
  };
  const error = () => { if (!closed) fault?.(); };
  function close() {
    if (closed) return;
    closed = true;
    const current = channel;
    channel = null;
    listener = fault = null;
    if (current) {
      try { remove.call(current, "message", message); } catch {}
      try { remove.call(current, "messageerror", error); } catch {}
      try { end.call(current); } catch {}
    }
    send = remove = end = null;
  }
  function subscribe(onMessage, onError) {
    if (closed || channel) tabGuardFail("TAB_CLOSED");
    if (typeof onMessage !== "function" || typeof onError !== "function") tabGuardFail("TAB_CONFIG");
    try {
      if (!host || host.isSecureContext !== true || typeof host.BroadcastChannel !== "function") {
        tabGuardFail("TAB_UNAVAILABLE");
      }
      const origin = new URL(host.location.origin);
      if (origin.origin !== host.location.origin || origin.username || origin.password ||
          !(origin.protocol === "https:" || (origin.protocol === "http:" &&
            ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)))) tabGuardFail("TAB_UNAVAILABLE");
      channel = new host.BroadcastChannel(name);
      // Snapshot native methods. Later property replacements cannot change transport.
      send = channel.postMessage;
      remove = channel.removeEventListener;
      end = channel.close;
      const add = channel.addEventListener;
      if (![send, remove, end, add].every(value => typeof value === "function")) tabGuardFail("TAB_TRANSPORT");
      listener = onMessage;
      fault = onError;
      add.call(channel, "message", message);
      add.call(channel, "messageerror", error);
      return true;
    } catch (cause) {
      close();
      if (cause instanceof TabGuardError && cause.code === "TAB_UNAVAILABLE") tabGuardFail("TAB_UNAVAILABLE");
      tabGuardFail("TAB_TRANSPORT");
    }
  }
  function post(value) {
    if (closed || !channel) tabGuardFail("TAB_CLOSED");
    const safe = validateTabSignal(value);
    try { send.call(channel, safe); return true; }
    catch { tabGuardFail("TAB_TRANSPORT"); }
  }
  return Object.freeze({ subscribe, post, close });
}
