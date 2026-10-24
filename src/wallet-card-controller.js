import { observeWalletProvider } from "./provider-events.js";
import { createWalletReadScope } from "./wallet-read-scope.js";
import { ThreeCoreWalletSession, normalizeAddress, normalizeChainId } from "./wallet-session.js";
import { inspectDappSpender } from "./dapp-preflight.js";
import { readPortfolioSnapshot } from "./portfolio-snapshot.js";
import { readTokenIdentity } from "./token-identity-reader.js";
import { readAllowanceSnapshot } from "./allowance-reader.js";
import { readTransferSnapshot } from "./transfer-reader.js";
import { collectPeriod } from "./period-reader.js";
import { portfolioFailureStatus } from "./portfolio-progress.js";
import { readErrorCode, readErrorMessage } from "./provider-error.js";

/**
 * Own one demo card's session and visible operation. Provider replies can arrive
 * after a different user action; only the current operation may update the view.
 * No timers, automatic reconnects, signatures or transaction requests.
 */
export function createWalletCardController({
  agent, siteOrigin, rpcSupervisor, onChange = () => {}, isAccessAllowed = () => true,
  createSession = (options) => new ThreeCoreWalletSession(options),
}) {
  let wallet = null;
  let generation = 0;
  let pendingConnect = null;
  let unwatch = () => {};
  let disposed = false;
  let boundaryDepth = 0;
  let notifying = false;
  let activePeriodAborter = null;
  let activeReadScope = null;
  function boundary(fn) {
    boundaryDepth++;
    try { return fn(); } finally { boundaryDepth--; }
  }
  function consume(value) {
    if (value === null || !["object", "function"].includes(typeof value)) return false;
    const then = value.then;
    if (typeof then !== "function") return false;
    new Promise((resolve, reject) => then.call(value, resolve, reject)).catch(() => {});
    return true;
  }
  function cleanup(fn) {
    try {
      return boundary(() => { const result = fn(); return !consume(result) && result !== false; });
    } catch { return false; }
  }
  function stopPeriodRead() {
    const scope = activeReadScope;
    activeReadScope = null;
    scope?.cancel();
    const previous = activePeriodAborter;
    activePeriodAborter = null;
    return cleanup(() => previous?.abort());
  }
  let state = Object.freeze({ phase: "disconnected", connection: null, result: null, error: null });
  const cancelled = () => Object.assign(new Error("Obsolete view operation"), { code: "STALE_VIEW" });
  const current = (id, session) => !disposed && id === generation && wallet === session;
  function publish(phase, result = null, error = null) {
    if (disposed) return;
    const revision = generation, session = wallet;
    let connection;
    try { connection = boundary(() => session?.state ?? null); } catch { connection = null; }
    if (disposed || revision !== generation || session !== wallet) return;
    state = Object.freeze({ phase, connection, result, error });
    // Observers may stop/dispose, but cannot start another operation mid-transition.
    if (notifying) return;
    notifying = true;
    try {
      // A view callback may stop or clear this operation while rendering it.
      // Deliver that restrictive state too; otherwise the internal state is
      // stopped but the view can retain a connected label or a stale balance.
      // Reentrant starts are blocked by boundaryDepth. Bound malicious observers.
      for (let count = 0; count < 3 && !disposed; count++) {
        const shown = state;
        cleanup(() => onChange(shown));
        if (state.phase === shown.phase && state.connection === shown.connection &&
            state.result === shown.result && state.error === shown.error) break;
      }
    } finally { notifying = false; }
  }
  function release() {
    const previous = wallet;
    const remove = unwatch;
    wallet = null; // Stale callbacks are inert before removing listeners.
    unwatch = () => {};
    const stopped = stopPeriodRead();
    const removed = cleanup(remove);
    const disconnected = cleanup(() => previous?.disconnect());
    return stopped && removed && disconnected;
  }
  function disconnect(message = null) {
    if (disposed) return true;
    generation++;
    pendingConnect = null;
    const completed = release();
    publish("disconnected", null, message);
    return completed;
  }
  function watch(provider, session, account, chainId) {
    const invalidate = () => {
      if (wallet === session) disconnect("接続先が変わりました。内容を確認して再接続してください。");
    };
    const events = {
      accountsChanged(accounts) {
        try {
          if (!Array.isArray(accounts) || !accounts.length || normalizeAddress(accounts[0]) !== account) invalidate();
        } catch { invalidate(); }
      },
      chainChanged(chain) {
        try { if (normalizeChainId(chain) !== chainId) invalidate(); } catch { invalidate(); }
      },
      disconnect: invalidate,
    };
    const observer = observeWalletProvider(provider, events, () => wallet === session && !disposed);
    if (wallet === session && !disposed) unwatch = observer.dispose;
    else cleanup(observer.dispose);
  }

  function allowed() {
    try { return boundary(() => {
      const value = isAccessAllowed();
      return !consume(value) && value === true;
    }); } catch { return false; }
  }
  function connect({ provider, account, chainId } = {}) {
    if (boundaryDepth || disposed) return Promise.resolve(false);
    if (!allowed()) {
      disconnect("接続操作を停止しています。保護パネルから再開してください。");
      return Promise.resolve(false);
    }
    if (disposed) return Promise.resolve(false);
    if (pendingConnect && pendingConnect.provider === provider &&
        pendingConnect.account === account && pendingConnect.chainId === chainId) {
      return pendingConnect.promise;
    }
    const id = ++generation;
    release();
    if (disposed || id !== generation) return Promise.resolve(false);
    publish("connecting");
    if (disposed || id !== generation) return Promise.resolve(false);
    const promise = (async () => {
      let session;
      try {
        const expectedAccount = normalizeAddress(account);
        session = boundary(() => createSession({
          provider, agent, siteOrigin, rpcSupervisor, isAccessAllowed, approvedOrigins: [siteOrigin], expectedAccount, chainId,
        }));
        if (disposed || id !== generation) { cleanup(() => session?.disconnect()); return false; }
        wallet = session;
        boundary(() => watch(provider, session, expectedAccount, chainId));
        if (!current(id, session)) return false;
        await boundary(() => session.connect());
        if (!current(id, session)) return false;
        publish("connected");
        return current(id, session) && allowed() && current(id, session);
      } catch (error) {
        if (disposed || id !== generation) return false;
        const code = readErrorCode(error), message = readErrorMessage(error);
        if (disposed || id !== generation) return false;
        release();
        const messages = {
          __proto__: null,
          CONNECT_TIMEOUT: "Walletからの応答がないため接続を終了しました。再接続してください。",
          PERMISSION_TIMEOUT: "接続許可の待機を終了しました。Walletの許可画面を確認し、完了後に再接続してください。",
          PERMISSION_PENDING: "Walletの許可画面がまだ処理中です。Wallet側で許可または拒否を完了してから再接続してください。",
        };
        publish("disconnected", null, messages[code] ?? message);
        return false;
      }
    })();
    const pending = { provider, account, chainId, promise };
    pendingConnect = pending;
    const clearPending = () => { if (pendingConnect === pending) pendingConnect = null; };
    promise.then(clearPending, clearPending);
    return promise;
  }
  function clearResult() {
    if (disposed || state.phase === "connecting") return;
    generation++;
    stopPeriodRead();
    publish(wallet?.state.connected ? "connected" : "disconnected");
  }
  async function runRead(task) {
    if (boundaryDepth || disposed) return false;
    if (!allowed()) { disconnect("接続操作を停止しています。"); return false; }
    if (disposed) return false;
    if (!wallet?.state.connected) {
      // A read click must not cancel a pending permission prompt.
      if (state.phase !== "connecting") publish("disconnected", null, "先にWalletを接続してください。");
      return false;
    }
    const session = wallet;
    const id = ++generation;
    stopPeriodRead();
    if (!current(id, session)) return false;
    const scope = createWalletReadScope({ isCurrent: () =>
      current(id, session) && allowed() && current(id, session),
      onSettled() {
        // A locally cancelled RPC can later reveal lost authorization. Clear
        // that same connection, but never a replacement session's result.
        if (!current(id, session) && !disposed && wallet === session && !session.state.connected) {
          disconnect("接続が無効になりました。再接続してください。");
        }
      },
    });
    activeReadScope = scope;
    publish("reading");
    const read = async (fn) => {
      if (!current(id, session)) throw cancelled();
      const result = await fn();
      if (!current(id, session) || !session.state.connected) throw cancelled();
      return result;
    };
    try {
      if (!current(id, session)) return false;
      const result = await task(scope.bind(session), read);
      if (!current(id, session)) return false;
      publish("connected", Object.freeze(result));
      return current(id, session) && allowed() && current(id, session);
    } catch (error) {
      const code = readErrorCode(error), message = readErrorMessage(error);
      // Even a superseded read can reveal loss of the shared connection.
      // Clear that connection's view, but never touch a replacement session.
      if (!disposed && wallet === session && !session.state.connected) {
        disconnect(code === "READ_TIMEOUT"
          ? "Walletからの応答がないため読み取りを終了しました。再接続してください。"
          : "接続が無効になりました。再接続してください。");
      } else if (current(id, session)) {
        publish("connected", null, message);
      }
      return false;
    } finally {
      scope.cancel();
      if (activeReadScope === scope) activeReadScope = null;
    }
  }
  function readBalances({ tokenAddress = "", spenderAddress = "" } = {}) {
    return runRead(async (session, read) => {
      const token = tokenAddress ? normalizeAddress(tokenAddress) : null;
      const spender = spenderAddress ? normalizeAddress(spenderAddress) : null;
      if (spender && !token) throw Error("承認額の確認にはトークンのアドレスも必要です。");
      const block = await read(() => session.getBlockSnapshot());
      const native = await read(() => session.getNativeBalance(block.hash));
      const code = token ? await read(() => session.getContractCode(token, block.hash)) : null;
      const balance = code?.deployed ? await read(() => session.getTokenBalance(token, block.hash)) : null;
      const allowance = code?.deployed && spender
        ? await read(() => session.getTokenAllowance(token, spender, block.hash)) : null;
      const final = await read(() => session.getBlockSnapshot(block.number));
      if (final.number !== block.number || final.hash !== block.hash) {
        throw Error("参照中にブロックが変わりました。もう一度確認してください。");
      }
      return {
        kind: "balances", blockNumber: BigInt(block.number).toString(), blockHash: block.hash,
        account: session.state.account, tokenAddress: token, spenderAddress: spender,
        nativeBalanceBaseUnits: native.toString(), tokenHasCode: code?.deployed ?? null,
        tokenBalanceBaseUnits: balance?.toString() ?? null,
        existingAllowanceBaseUnits: allowance?.toString() ?? null,
      };
    });
  }
  function inspect(options) {
    // Capture the caller's values before the first asynchronous read.
    const { tokenAddress, spenderAddress } = options ?? {};
    return runRead(async (session, read) => ({
      kind: "preflight",
      ...await read(() => inspectDappSpender(session, { tokenAddress, spenderAddress })),
    }));
  }
  function dispose() {
    if (disposed) return;
    // Terminal state is visible before extension cleanup can call back.
    disposed = true;
    generation++;
    pendingConnect = null;
    release();
    state = Object.freeze({ phase: "disposed", connection: null, result: null, error: null });
  }
  return Object.freeze({
    get state() { return state; }, connect, disconnect, clearResult, readBalances, inspect, dispose,
    async readPeriod(plan, options = {}) {
      let result;
      let failure;
      const accepted = await runRead(async (session, read) => {
        const aborter = new AbortController();
        activePeriodAborter = aborter;
        const cancel = () => aborter.abort();
        options.signal?.addEventListener("abort", cancel, { once: true });
        if (options.signal?.aborted) aborter.abort();
        try {
          result = await read(() => collectPeriod(session, plan, { ...options, signal: aborter.signal }));
          return { kind: "period", blockNumber: result.plan.laterBlock };
        } catch (error) {
          failure = readErrorCode(error);
          throw error;
        } finally {
          options.signal?.removeEventListener("abort", cancel);
          if (activePeriodAborter === aborter) activePeriodAborter = null;
        }
      });
      if (!accepted || !result) {
        throw Object.assign(Error("Period observation unavailable"), { code: failure ?? "PERIOD_NOT_CONNECTED" });
      }
      return result;
    },
    async readTransfers(request, options) {
      let result;
      let failure;
      const accepted = await runRead(async (session, read) => {
        try { result = await read(() => readTransferSnapshot(session, request, options)); }
        catch (error) { failure = readErrorCode(error); throw error; }
        return { kind: "transfers", ...result, blockNumber: result.range.toBlock };
      });
      if (!accepted || !result) {
        throw Object.assign(Error("Transfer observation unavailable"), { code: failure ?? "TRANSFER_NOT_CONNECTED" });
      }
      return result;
    },
    async readAllowances(plan, options) {
      let result;
      let failure;
      const accepted = await runRead(async (session, read) => {
        try { result = await read(() => readAllowanceSnapshot(session, plan, options)); }
        catch (error) { failure = readErrorCode(error); throw error; }
        return { kind: "allowances", ...result };
      });
      if (!accepted || !result) {
        throw Object.assign(Error("Allowance observation unavailable"), { code: failure ?? "ALLOWANCE_NOT_CONNECTED" });
      }
      return result;
    },
    async readIdentity(options) {
      let result;
      let failure;
      const accepted = await runRead(async (session, read) => {
        try { result = await read(() => readTokenIdentity(session, options)); }
        catch (error) { failure = readErrorCode(error); throw error; }
        return { kind: "token-identity", ...result };
      });
      if (!accepted || !result) {
        throw Object.assign(Error("Token identity unavailable"), { code: failure ?? "IDENTITY_NOT_CONNECTED" });
      }
      return result;
    },
    async readPortfolio(options) {
      let result;
      let failure;
      const accepted = await runRead(async (session, read) => {
        try { result = await read(() => readPortfolioSnapshot(session, options)); }
        catch (error) {
          failure = portfolioFailureStatus(error);
          throw Object.assign(Error(failure.message), { code: failure.code });
        }
        return { kind: "portfolio", ...result };
      });
      if (!accepted || !result) {
        throw Object.assign(Error("Portfolio snapshot unavailable"), { code: failure?.code ?? "PORTFOLIO_UNAVAILABLE" });
      }
      return result;
    },
  });
}
