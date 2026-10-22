import { ThreeCoreWalletSession, normalizeAddress, normalizeChainId } from "./wallet-session.js";
import { inspectDappSpender } from "./dapp-preflight.js";
import { readPortfolioSnapshot } from "./portfolio-snapshot.js";
import { readTokenIdentity } from "./token-identity-reader.js";
import { readAllowanceSnapshot } from "./allowance-reader.js";
import { portfolioFailureStatus } from "./portfolio-progress.js";
import { readErrorCode, readErrorMessage } from "./provider-error.js";

/**
 * Own one demo card's session and visible operation. Provider replies can arrive
 * after a different user action; only the current operation may update the view.
 * No timers, automatic reconnects, signatures or transaction requests.
 */
export function createWalletCardController({
  agent, siteOrigin, onChange = () => {},
  createSession = (options) => new ThreeCoreWalletSession(options),
}) {
  let wallet = null;
  let generation = 0;
  let pendingConnect = null;
  let unwatch = () => {};
  let disposed = false;
  let state = Object.freeze({ phase: "disconnected", connection: null, result: null, error: null });
  const cancelled = () => Object.assign(new Error("Obsolete view operation"), { code: "STALE_VIEW" });
  const current = (id, session) => !disposed && id === generation && wallet === session;
  function publish(phase, result = null, error = null) {
    state = Object.freeze({ phase, connection: wallet?.state ?? null, result, error });
    onChange(state);
  }
  function release() {
    const previous = wallet;
    wallet = null; // Stale callbacks are inert before removing listeners.
    unwatch();
    unwatch = () => {};
    previous?.disconnect();
  }
  function disconnect(message = null) {
    if (disposed) return;
    generation++;
    pendingConnect = null;
    release();
    publish("disconnected", null, message);
  }
  function watch(provider, session, account, chainId) {
    const listeners = [];
    unwatch = () => {
      for (const [event, listener] of listeners) {
        try { provider.removeListener?.(event, listener); } catch {}
      }
    };
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
    if (typeof provider.on === "function") {
      for (const [event, listener] of Object.entries(events)) {
        listeners.push([event, listener]);
        provider.on(event, listener);
        if (wallet !== session) throw cancelled();
      }
    }
  }
  function connect({ provider, account, chainId } = {}) {
    if (disposed) return Promise.resolve(false);
    if (pendingConnect && pendingConnect.provider === provider &&
        pendingConnect.account === account && pendingConnect.chainId === chainId) {
      return pendingConnect.promise;
    }
    const id = ++generation;
    release();
    publish("connecting");
    const promise = (async () => {
      let session;
      try {
        const expectedAccount = normalizeAddress(account);
        session = createSession({
          provider, agent, siteOrigin, approvedOrigins: [siteOrigin], expectedAccount, chainId,
        });
        wallet = session;
        watch(provider, session, expectedAccount, chainId);
        if (!current(id, session)) return false;
        await session.connect();
        if (!current(id, session)) return false;
        publish("connected");
        return true;
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
    publish(wallet?.state.connected ? "connected" : "disconnected");
  }
  async function runRead(task) {
    if (disposed) return false;
    if (!wallet?.state.connected) {
      // A read click must not cancel a pending permission prompt.
      if (state.phase !== "connecting") publish("disconnected", null, "先にWalletを接続してください。");
      return false;
    }
    const session = wallet;
    const id = ++generation;
    publish("reading");
    const read = async (fn) => {
      if (!current(id, session)) throw cancelled();
      const result = await fn();
      if (!current(id, session) || !session.state.connected) throw cancelled();
      return result;
    };
    try {
      const result = await task(session, read);
      if (!current(id, session)) return false;
      publish("connected", Object.freeze(result));
      return true;
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
    generation++;
    pendingConnect = null;
    release();
    disposed = true;
    state = Object.freeze({ phase: "disposed", connection: null, result: null, error: null });
  }
  return Object.freeze({
    get state() { return state; }, connect, disconnect, clearResult, readBalances, inspect, dispose,
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
