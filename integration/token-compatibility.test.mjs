import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ThreeCoreWalletSession } from "../src/wallet-session.js";
import { inspectDappSpender } from "../src/dapp-preflight.js";
import { createWalletCardController } from "../src/wallet-card-controller.js";
import { createWalletProviderRegistry, ANNOUNCE_EVENT } from "../src/provider-registry.js";

// Run from a compiled DAT / EMA-Draft / CAWELON-Draft checkout. Hardhat and
// its pinned dependencies belong to that token, not the browser wallet.
const packagePath = resolve("package.json");
const tokens = {
  "@0628dao/datcore": { agent: "DAT", contract: "DATCore", name: "DATCORE", units: 1_000_000_000n },
  "@0628dao/emacore": { agent: "EMA", contract: "EMACore", name: "EMA CORE", units: 777_000_000n },
  "@0628dao/caweloncore": { agent: "CAWELON", contract: "CAWELONCore", name: "CAWELON CORE", units: 420_000_000_000_000n },
};
const spec = tokens[JSON.parse(readFileSync(packagePath, "utf8")).name];
assert.ok(spec, "Run from one of the three supported token repositories");
const requireToken = createRequire(packagePath);
const { config, network } = await import(pathToFileURL(requireToken.resolve("hardhat")).href);
assert.equal(config.networks.hardhatOp.type, "edr-simulated");
assert.equal(config.networks.hardhatOp.forking, undefined, "No remote fork is permitted");
const maximum = (1n << 256n) - 1n;

for (const chainId of [8453, 84532]) {
  describe(`${spec.agent}: Wallet against the local EVM with chain ID ${chainId}`, async () => {
    // The chain ID models Base's domain; this remains an in-process EVM.
    const connection = await network.create({
      network: "hardhatOp", chainType: "op", override: { chainId },
    });
    after(() => connection.close());
    const { viem, provider } = connection;
    const client = await viem.getPublicClient();
    const [holder, spender, empty] = await viem.getWalletClients();
    let token;
    beforeEach(async () => {
      token = await viem.deployContract(spec.contract, [holder.account.address]);
    });

    function walletFor(account = holder.account.address, expectedChain = chainId, onStateRead = async () => {}) {
      const requests = [];
      const bridge = {
        async request(args) {
          requests.push(args);
          // Account permission is synthetic; all EVM read results are real.
          if (args.method === "eth_requestAccounts" || args.method === "eth_accounts") {
            return [account];
          }
          assert.ok(["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_getBalance", "eth_call"].includes(args.method),
            `Wallet attempted a forbidden method: ${args.method}`);
          if (args.method === "eth_call") {
            const [{ data, to }] = args.params;
            assert.equal(to.toLowerCase(), token.address.toLowerCase());
            assert.match(data, /^(0x70a08231[0-9a-f]{64}|0xdd62ed3e[0-9a-f]{128})$/);
          }
          const result = await provider.request(args);
          if (["eth_getCode", "eth_getBalance", "eth_call"].includes(args.method)) {
            await onStateRead(args);
          }
          return result;
        },
      };
      const wallet = new ThreeCoreWalletSession({
        provider: bridge, agent: spec.agent,
        siteOrigin: "http://localhost:4173", approvedOrigins: ["http://localhost:4173"],
        expectedAccount: account, chainId: expectedChain,
      });
      return { wallet, requests, provider: bridge };
    }

    async function inspectWithoutMutation(wallet, spenderAddress) {
      const state = async () => ({
        block: await client.getBlockNumber({ cacheTime: 0 }),
        nonce: await client.getTransactionCount({ address: holder.account.address }),
        supply: await token.read.totalSupply(),
        balance: await token.read.balanceOf([holder.account.address]),
        allowance: await token.read.allowance([holder.account.address, spenderAddress]),
        permitNonce: await token.read.nonces([holder.account.address]),
      });
      const before = await state();
      const result = await inspectDappSpender(wallet, { tokenAddress: token.address, spenderAddress });
      assert.deepEqual(await state(), before, "Preflight must not mutate the EVM");
      assert.equal(result.blockNumber, before.block.toString());
      assert.equal(result.blockHash, (await client.getBlock({ blockNumber: before.block })).hash);
      assert.equal(result.readOnly, true);
      assert.equal(result.securityAudit, false);
      return JSON.parse(JSON.stringify(result));
    }

    it("retains the validated EIP-6963 provider through duplicate discovery and actual token reads", async () => {
      const selected = walletFor();
      const other = walletFor(empty.account.address);
      const events = new EventTarget();
      const registry = createWalletProviderRegistry({ eventTarget: events });
      const uuid = "aabbccdd-1234-4234-8234-aabbccddeeff";
      const info = { uuid, name: "Local EVM Wallet", rdns: "test.local" };
      let reads = 0, wallet;
      const announce = detail => events.dispatchEvent(new CustomEvent(ANNOUNCE_EVENT, { detail }));
      try {
        announce(Object.defineProperty({ info }, "provider", {
          get() { return ++reads === 1 ? selected.provider : other.provider; },
        }));
        announce({ info: { ...info, uuid: uuid.toUpperCase() }, provider: other.provider });
        assert.equal(registry.list().length, 1);
        assert.equal(registry.getProvider(uuid.toUpperCase()), selected.provider);
        assert.deepEqual(selected.requests, []);
        assert.deepEqual(other.requests, []);
        wallet = new ThreeCoreWalletSession({
          provider: registry.getProvider(uuid), agent: spec.agent,
          siteOrigin: "http://localhost:4173", approvedOrigins: ["http://localhost:4173"],
          expectedAccount: holder.account.address, chainId,
        });
        await wallet.connect();
        const report = await inspectWithoutMutation(wallet, spender.account.address);
        assert.equal(report.tokenBalanceBaseUnits, (spec.units * 10n ** 18n).toString());
        assert.equal(report.existingAllowanceBaseUnits, "0");
        assert.equal(reads, 1);
        assert.deepEqual(other.requests, []);
      } finally {
        wallet?.disconnect(); selected.wallet.disconnect(); other.wallet.disconnect(); registry.dispose();
      }
    });

    it("recovers from a malformed provider rejection without retaining balances or mutating the token", async () => {
      const selected = walletFor();
      let fail = false;
      const bridge = { request: args => fail && args.method === "eth_call"
        ? Promise.reject(null) : selected.provider.request(args) };
      const controller = createWalletCardController({ agent: spec.agent, siteOrigin: "http://localhost:4173" });
      const options = { tokenAddress: token.address, spenderAddress: spender.account.address };
      const state = async () => ({
        block: await client.getBlockNumber({ cacheTime: 0 }),
        nonce: await client.getTransactionCount({ address: holder.account.address }),
        supply: await token.read.totalSupply(), balance: await token.read.balanceOf([holder.account.address]),
        allowance: await token.read.allowance([holder.account.address, spender.account.address]),
        permitNonce: await token.read.nonces([holder.account.address]),
      });
      const before = await state();
      try {
        assert.equal(await controller.connect({ provider: bridge, account: holder.account.address, chainId }), true);
        assert.equal(await controller.readBalances(options), true);
        assert.equal(controller.state.result.tokenBalanceBaseUnits, (spec.units * 10n ** 18n).toString());
        fail = true;
        assert.equal(await controller.readBalances(options), false);
        assert.equal(controller.state.phase, "connected");
        assert.equal(controller.state.result, null);
        assert.ok(controller.state.error.length > 0);
        fail = false;
        assert.equal(await controller.readBalances(options), true);
        assert.equal(controller.state.result.tokenBalanceBaseUnits, (spec.units * 10n ** 18n).toString());
        assert.equal(controller.state.result.existingAllowanceBaseUnits, "0");
        assert.deepEqual(await state(), before);
        assert.equal(selected.requests.filter(x => x.method === "eth_requestAccounts").length, 1);
      } finally { controller.dispose(); selected.wallet.disconnect(); }
    });

    it("reads identity, full raw supply and native balance without precision loss", async () => {
      const { wallet } = walletFor();
      await wallet.connect();
      assert.equal(await token.read.name(), spec.name);
      assert.equal(await token.read.symbol(), spec.agent);
      assert.equal(await token.read.decimals(), 18);
      assert.equal(await wallet.getTokenBalance(token.address), spec.units * 10n ** 18n);
      assert.equal(await wallet.getNativeBalance(), await client.getBalance({ address: holder.account.address }));
      const block = await wallet.getBlockSnapshot();
      assert.equal(await wallet.getNativeBalance(block.hash),
        await client.getBalance({ address: holder.account.address, blockNumber: BigInt(block.number) }));
      assert.equal((await wallet.getContractCode(token.address)).deployed, true);
      wallet.disconnect();
    });

    it("reports an EOA spender and zero allowance without misreporting token code", async () => {
      const { wallet } = walletFor();
      await wallet.connect();
      const result = await inspectWithoutMutation(wallet, spender.account.address);
      assert.equal(result.tokenHasCode, true);
      assert.equal(result.spenderHasCode, false);
      assert.deepEqual(result.notices, ["SPENDER_CODE_MISSING"]);
      assert.equal(result.tokenBalanceBaseUnits, (spec.units * 10n ** 18n).toString());
      assert.equal(result.existingAllowanceBaseUnits, "0");
      wallet.disconnect();
    });

    it("reads an existing contract-spender allowance without granting approval", async () => {
      // A second local token is only a bytecode fixture, not an actual router.
      const codeFixture = await viem.deployContract(spec.contract, [holder.account.address]);
      await token.write.approve([codeFixture.address, 1234567890123456789n]);
      const { wallet } = walletFor();
      await wallet.connect();
      const result = await inspectWithoutMutation(wallet, codeFixture.address);
      assert.equal(result.spenderHasCode, true);
      assert.deepEqual(result.notices, []);
      assert.equal(result.existingAllowanceBaseUnits, "1234567890123456789");
      wallet.disconnect();
    });

    it("round-trips the maximum uint256 allowance through ABI and JSON", async () => {
      await token.write.approve([spender.account.address, maximum]);
      const { wallet } = walletFor();
      await wallet.connect();
      const result = await inspectWithoutMutation(wallet, spender.account.address);
      assert.equal(result.existingAllowanceBaseUnits, maximum.toString());
      wallet.disconnect();
    });

    it("reads exact balance and allowance after a simulated delegated spend", async () => {
      const amount = 1234567890123456789n;
      await token.write.approve([spender.account.address, amount * 2n + 5n]);
      await token.write.transferFrom(
        [holder.account.address, empty.account.address, amount], { account: spender.account },
      );
      const { wallet } = walletFor();
      await wallet.connect();
      const result = await inspectWithoutMutation(wallet, spender.account.address);
      assert.equal(result.tokenBalanceBaseUnits, (spec.units * 10n ** 18n - amount).toString());
      assert.equal(result.existingAllowanceBaseUnits, (amount + 5n).toString());
      wallet.disconnect();
    });

    it("reflects a simulated burn and allowance revocation", async () => {
      await token.write.approve([spender.account.address, maximum]);
      await token.write.approve([spender.account.address, 0n]);
      await token.write.burn([19n]);
      const { wallet } = walletFor();
      await wallet.connect();
      const result = await inspectWithoutMutation(wallet, spender.account.address);
      assert.equal(result.tokenBalanceBaseUnits, (spec.units * 10n ** 18n - 19n).toString());
      assert.equal(result.existingAllowanceBaseUnits, "0");
      assert.equal(await token.read.totalSupply(), spec.units * 10n ** 18n - 19n);
      wallet.disconnect();
    });

    it("reports missing token code without issuing ERC-20 calls", async () => {
      const { wallet, requests } = walletFor();
      await wallet.connect();
      const result = await inspectDappSpender(wallet, {
        tokenAddress: empty.account.address, spenderAddress: spender.account.address,
      });
      assert.equal(result.tokenBalanceBaseUnits, null);
      assert.equal(result.existingAllowanceBaseUnits, null);
      assert.deepEqual(result.notices, ["TOKEN_CODE_MISSING", "SPENDER_CODE_MISSING"]);
      assert.equal(requests.some(({ method }) => method === "eth_call"), false);
      wallet.disconnect();
    });

    it("rejects the other chain before requesting synthetic account permission", async () => {
      const { wallet, requests } = walletFor(holder.account.address, chainId === 8453 ? 84532 : 8453);
      await assert.rejects(wallet.connect(), { code: "WRONG_CHAIN" });
      assert.deepEqual(requests.map(({ method }) => method), ["eth_chainId"]);
      assert.equal(wallet.state.connected, false);
    });

    it("keeps an empty account isolated from the initial holder", async () => {
      const { wallet } = walletFor(empty.account.address);
      await wallet.connect();
      assert.equal(await wallet.getTokenBalance(token.address), 0n);
      assert.equal(await wallet.getTokenAllowance(token.address, spender.account.address), 0n);
      assert.equal(await token.read.balanceOf([holder.account.address]), spec.units * 10n ** 18n);
      wallet.disconnect();
    });

    it("presents actual token data through the UI controller and clears it on disconnect", async () => {
      const bridge = walletFor();
      const controller = createWalletCardController({
        agent: spec.agent, siteOrigin: "http://localhost:4173",
      });
      assert.equal(await controller.connect({
        provider: bridge.provider, account: holder.account.address, chainId,
      }), true);
      assert.equal(await controller.readBalances({
        tokenAddress: token.address, spenderAddress: spender.account.address,
      }), true);
      const result = controller.state.result;
      assert.equal(result.tokenBalanceBaseUnits, (spec.units * 10n ** 18n).toString());
      assert.equal(result.existingAllowanceBaseUnits, "0");
      assert.equal(result.nativeBalanceBaseUnits,
        (await client.getBalance({ address: holder.account.address, blockNumber: BigInt(result.blockNumber) })).toString());
      controller.disconnect();
      assert.equal(controller.state.result, null);
      assert.equal(controller.state.connection, null);
      controller.dispose();
    });

    for (const code of [4100, 4900, 4901]) {
      it(`invalidates actual token inspection on injected provider error ${code} and reconnects without writes`, async () => {
        let failed = false;
        const bridge = walletFor(holder.account.address, chainId, async args => {
          // The EVM read is real; only the provider rejection is injected.
          if (failed && args.method === "eth_call" && args.params[0].data.startsWith("0xdd62ed3e")) {
            throw Object.assign(Error("Synthetic provider access loss"), { code });
          }
        });
        const controller = createWalletCardController({ agent: spec.agent, siteOrigin: "http://localhost:4173" });
        const connect = () => controller.connect({ provider: bridge.provider, account: holder.account.address, chainId });
        const options = { tokenAddress: token.address, spenderAddress: spender.account.address };
        const readState = async () => ({
          block: await client.getBlockNumber({ cacheTime: 0 }),
          nonce: await client.getTransactionCount({ address: holder.account.address }),
          native: await client.getBalance({ address: holder.account.address }),
          supply: await token.read.totalSupply(),
          balance: await token.read.balanceOf([holder.account.address]),
          allowance: await token.read.allowance([holder.account.address, spender.account.address]),
          permitNonce: await token.read.nonces([holder.account.address]),
        });
        const before = await readState();
        try {
          assert.equal(await connect(), true);
          assert.equal(await controller.inspect(options), true);
          assert.equal(controller.state.result.tokenBalanceBaseUnits, before.balance.toString());
          failed = true;
          const operation = code === 4900 ? "readBalances" : "inspect";
          assert.equal(await controller[operation](options), false);
          assert.equal(controller.state.phase, "disconnected");
          assert.equal(controller.state.result, null);
          assert.equal(controller.state.connection, null);
          const count = bridge.requests.length;
          assert.equal(await controller[operation](options), false);
          assert.equal(bridge.requests.length, count, "No RPC after invalidation");
          assert.equal(bridge.requests.filter(x => x.method === "eth_requestAccounts").length, 1);
          failed = false;
          assert.equal(await connect(), true);
          assert.equal(await controller[operation](options), true);
          assert.equal(controller.state.result.tokenBalanceBaseUnits, before.balance.toString());
          assert.equal(controller.state.result.existingAllowanceBaseUnits, before.allowance.toString());
          assert.deepEqual(await readState(), before, "Failure and reconnection must not mutate the EVM");
        } finally {
          controller.dispose();
        }
      });
    }

    for (const ending of ["timeout", "manual disconnect"]) {
      it(`ends an unresponsive actual token read by ${ending} without accepting its late result`, { timeout: 10_000 }, async () => {
        let release, entered;
        const gate = new Promise(resolve => { release = resolve; });
        const started = new Promise(resolve => { entered = resolve; });
        let delayed = false;
        const bridge = walletFor(holder.account.address, chainId, async args => {
          if (delayed && args.method === "eth_call" && args.params[0].data.startsWith("0xdd62ed3e")) {
            entered();
            await gate; // Hold a real EVM result in the synthetic transport only.
          }
        });
        const controller = createWalletCardController({
          agent: spec.agent, siteOrigin: "http://localhost:4173",
          createSession: args => new ThreeCoreWalletSession({ ...args, readTimeoutMs: 500 }),
        });
        const connect = () => controller.connect({ provider: bridge.provider, account: holder.account.address, chainId });
        const options = { tokenAddress: token.address, spenderAddress: spender.account.address };
        const state = async () => ({
          block: await client.getBlockNumber({ cacheTime: 0 }),
          nonce: await client.getTransactionCount({ address: holder.account.address }),
          native: await client.getBalance({ address: holder.account.address }),
          supply: await token.read.totalSupply(),
          balance: await token.read.balanceOf([holder.account.address]),
          allowance: await token.read.allowance([holder.account.address, spender.account.address]),
          permitNonce: await token.read.nonces([holder.account.address]),
        });
        const before = await state();
        try {
          await connect();
          assert.equal(await controller.inspect(options), true);
          delayed = true;
          const pending = controller.inspect(options);
          await started;
          if (ending === "manual disconnect") controller.disconnect();
          assert.equal(await pending, false, "The local wait must end before the provider replies");
          assert.equal(controller.state.phase, "disconnected");
          assert.equal(controller.state.result, null);
          if (ending === "timeout") assert.match(controller.state.error, /応答.*再接続/);
          const count = bridge.requests.length;
          assert.equal(await controller.inspect(options), false);
          assert.equal(bridge.requests.length, count);
          assert.equal(bridge.requests.filter(x => x.method === "eth_requestAccounts").length, 1);
          delayed = false;
          assert.equal(await connect(), true);
          assert.equal(await controller.inspect(options), true);
          const fresh = controller.state;
          assert.equal(fresh.result.tokenBalanceBaseUnits, before.balance.toString());
          release();
          await new Promise(resolve => setImmediate(resolve));
          assert.equal(controller.state, fresh, "Late result cannot overwrite the replacement connection");
          assert.deepEqual(await state(), before);
        } finally {
          release();
          controller.dispose();
        }
      });
    }

    for (const stage of ["chain", "permission timeout", "account", "permission cancellation"]) {
      it(`recovers from an unresponsive connection ${stage} before inspecting actual token state`, { timeout: 10_000 }, async () => {
        const bridge = walletFor(), original = bridge.provider.request.bind(bridge.provider);
        let release, entered, held = false;
        const gate = new Promise(resolve => { release = resolve; });
        const started = new Promise(resolve => { entered = resolve; });
        const method = stage === "chain" ? "eth_chainId" : stage === "account" ? "eth_accounts" : "eth_requestAccounts";
        bridge.provider.request = async args => {
          const result = await original(args);
          if (!held && args.method === method) { held = true; entered(); await gate; }
          return result;
        };
        const controller = createWalletCardController({
          agent: spec.agent, siteOrigin: "http://localhost:4173",
          createSession: args => new ThreeCoreWalletSession({ ...args, connectTimeoutMs: 500, permissionTimeoutMs: 500 }),
        });
        const connect = () => controller.connect({ provider: bridge.provider, account: holder.account.address, chainId });
        const state = async () => ({
          block: await client.getBlockNumber({ cacheTime: 0 }),
          nonce: await client.getTransactionCount({ address: holder.account.address }),
          native: await client.getBalance({ address: holder.account.address }),
          supply: await token.read.totalSupply(),
          balance: await token.read.balanceOf([holder.account.address]),
          allowance: await token.read.allowance([holder.account.address, spender.account.address]),
          permitNonce: await token.read.nonces([holder.account.address]),
        });
        const before = await state();
        try {
          const pending = connect();
          await started;
          if (stage === "permission cancellation") controller.disconnect();
          assert.equal(await pending, false);
          assert.equal(controller.state.phase, "disconnected");
          assert.equal(controller.state.result, null);
          assert.equal(controller.state.connection, null);
          const count = bridge.requests.length;
          assert.equal(await controller.inspect({ tokenAddress: token.address, spenderAddress: spender.account.address }), false);
          assert.equal(bridge.requests.length, count, "No state read after failed connection");
          if (method === "eth_requestAccounts") {
            assert.equal(await connect(), false);
            assert.equal(bridge.requests.length, count, "No duplicate permission request");
            assert.match(controller.state.error, /許可画面/);
            release();
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(controller.state.phase, "disconnected", "No automatic connection on late permission");
          }
          assert.equal(await connect(), true);
          assert.equal(await controller.inspect({ tokenAddress: token.address, spenderAddress: spender.account.address }), true);
          const fresh = controller.state;
          assert.equal(fresh.result.tokenBalanceBaseUnits, before.balance.toString());
          assert.equal(fresh.result.existingAllowanceBaseUnits, before.allowance.toString());
          release();
          await new Promise(resolve => setImmediate(resolve));
          assert.equal(controller.state, fresh);
          assert.deepEqual(await state(), before);
        } finally {
          release();
          controller.dispose();
        }
      });
    }

    it("keeps the earlier balance and allowance when the local chain advances between reads", async () => {
      await token.write.approve([spender.account.address, 9n]);
      const before = await client.getBlock();
      let changed = false;
      const { wallet, requests } = walletFor(holder.account.address, chainId, async () => {
        if (!changed) {
          changed = true;
          // Only the local fixture mutates state; the Wallet bridge cannot write.
          await token.write.transfer([empty.account.address, 3n]);
          await token.write.approve([spender.account.address, 17n]);
        }
      });
      await wallet.connect();
      const result = await inspectDappSpender(wallet, {
        tokenAddress: token.address, spenderAddress: spender.account.address,
      });
      assert.equal(result.blockHash, before.hash);
      assert.equal(result.blockNumber, before.number.toString());
      assert.equal(result.tokenBalanceBaseUnits, (spec.units * 10n ** 18n).toString());
      assert.equal(result.existingAllowanceBaseUnits, "9");
      assert.equal(await token.read.balanceOf([holder.account.address]), spec.units * 10n ** 18n - 3n);
      assert.equal(await token.read.allowance([holder.account.address, spender.account.address]), 17n);
      assert.deepEqual(requests.filter(({ method }) => ["eth_call", "eth_getCode"].includes(method))
        .map(({ params }) => params[1]), Array(4).fill({ blockHash: before.hash, requireCanonical: true }));
      wallet.disconnect();
    });

    it("rejects a snapshot removed by a local chain rollback and can inspect afresh", async () => {
      const checkpoint = await provider.request({ method: "evm_snapshot" });
      await token.write.approve([spender.account.address, 9n]);
      const removed = await client.getBlock();
      let replaced = false;
      const { wallet, requests } = walletFor(holder.account.address, chainId, async () => {
        if (!replaced) {
          replaced = true;
          assert.equal(await provider.request({ method: "evm_revert", params: [checkpoint] }), true);
          await token.write.approve([spender.account.address, 11n]);
        }
      });
      await wallet.connect();
      await assert.rejects(inspectDappSpender(wallet, {
        tokenAddress: token.address, spenderAddress: spender.account.address,
      }), (error) => error.code === "BLOCK_CHANGED" || /not found|not exist|canonical|unknown block|invalid block/i.test(error.message));
      const reads = requests.filter(({ method }) => ["eth_call", "eth_getCode"].includes(method));
      assert.ok(reads.length > 0);
      for (const { params } of reads) {
        assert.deepEqual(params[1], { blockHash: removed.hash, requireCanonical: true });
      }
      const fresh = await inspectWithoutMutation(wallet, spender.account.address);
      assert.notEqual(fresh.blockHash, removed.hash);
      assert.equal(fresh.existingAllowanceBaseUnits, "11");
      wallet.disconnect();
    });
  });
}
