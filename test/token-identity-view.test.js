import test from "node:test";
import assert from "node:assert/strict";
import { catalogToken } from "../src/token-catalog.js";
import { describeCatalog, describeTokenObservation, describeTokenComparison,
  tokenIdentityErrorMessage, tokenIdentityProgressMessage } from "../src/token-identity-view.js";
import { observation, ACCOUNT, OTHER, HASH } from "./helpers/identity-fixtures.js";

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const chainId of [8453, 84532]) {
    test(agent + " catalog includes exact public identity on " + chainId, () => {
      const token = catalogToken({ agent, chainId });
      const output = describeCatalog({ agent, chainId });
      for (const value of [agent, token.name, token.address, token.repository, "18"]) {
        assert.ok(output.includes(value), value);
      }
      assert.match(output, /一覧表示だけでは/);
      if (chainId === 84532) assert.match(output, /テスト用ERC-20/);
    });

    test(agent + " observation includes exact amount and provenance on " + chainId, () => {
      const row = observation({}, agent, chainId);
      const output = describeTokenObservation(row, "read");
      for (const value of [ACCOUNT, HASH, row.tokenAddress, row.siteOrigin,
        "1.234567890123456789 " + agent, "9.007199254740993123 ETH",
        row.balanceBaseUnits, row.nativeBalanceBaseUnits, "42"]) {
        assert.ok(output.includes(value), value);
      }
      assert.match(output, /今回読み取ったブロック時点/);
      assert.match(output, /現在の接続・所有権・安全性を証明しません/);
      if (chainId === 84532) assert.match(output, /本番の資産残高として扱わない/);
      assert.doesNotMatch(output, /undefined|NaN|Infinity/);
    });
  }
}

for (const provenance of [undefined, "imported", "unknown", "LIVE", ""]) {
  test("only the explicit read provenance represents a read: " + String(provenance), () => {
    const output = describeTokenObservation(observation(), provenance);
    assert.match(output, /ファイルから読み込んだ過去の記録/);
    assert.match(output, /真正性を証明しません/);
    assert.doesNotMatch(output, /今回読み取った/);
  });
}

for (const [input, expected] of [
  [observation().tokenAddress, "登録情報と一致"],
  [catalogToken({ agent: "EMA", chainId: 8453 }).address, "別のトークン"],
  [catalogToken({ agent: "DAT", chainId: 84532 }).address, "別のネットワーク"],
  [OTHER, "登録されていません"],
  ["0x12", "形式を確認"],
]) {
  test("catalog explains an input without guessing: " + expected, () => {
    assert.ok(describeCatalog({ agent: "DAT", chainId: 8453 }, input).includes(expected));
  });
}

test("missing code preserves unknown and never formats zero DAT", () => {
  const output = describeTokenObservation(observation({ hasCode: false, metadata: null, balanceBaseUnits: null }));
  assert.match(output, /契約コードが見つかりません/);
  assert.match(output, /トークンの最小単位: 不明/);
  assert.doesNotMatch(output, /トークン残高: 0 DAT/);
});

for (const field of ["name", "symbol", "decimals", "totalSupply"]) {
  test("metadata mismatch is visible and prevents trusted symbol formatting: " + field, () => {
    const row = observation();
    row.metadata[field] = field === "decimals" ? 6 : field === "totalSupply"
      ? "1000000000000000000000000001" : "different";
    const output = describeTokenObservation(row, "read");
    assert.match(output, /一致しない/);
    assert.match(output, /照合未完了/);
    assert.ok(output.includes(row.balanceBaseUnits));
    assert.doesNotMatch(output, /トークン残高: 1.234/);
  });
}

test("lower supply does not become a claim of a burn transaction", () => {
  const row = observation();
  row.metadata.totalSupply = "900000000000000000000000000";
  const output = describeTokenObservation(row);
  assert.match(output, /上限以内/);
  assert.match(output, /減少理由や取引をこの照合だけでは特定できません/);
});

test("same observation compares as exactly zero without gain claims", () => {
  const output = describeTokenComparison(observation(), observation());
  assert.match(output, /トークン残高の差: 0/);
  assert.match(output, /利益や送金履歴ではありません/);
});

for (const delta of [1n, -1n, 1000000000000000000n, -1000000000000000000n]) {
  test("comparison presents exact signed change " + delta, () => {
    const earlier = observation();
    const later = observation({ blockNumber: "43", balanceBaseUnits: (BigInt(earlier.balanceBaseUnits) + delta).toString() });
    const output = describeTokenComparison(earlier, later);
    assert.ok(output.includes("最小単位の差: " + delta.toString()));
    assert.ok(output.includes("42 → 43"));
    if (delta === 1n) assert.ok(output.includes("+0.000000000000000001"));
    if (delta === -1n) assert.ok(output.includes("-0.000000000000000001"));
  });
}

test("comparison never silently renders different accounts", () => {
  assert.throws(() => describeTokenComparison(observation(), observation({ account: OTHER })),
    error => error.code === "IDENTITY_COMPARISON_CONTEXT");
});

test("failed identity checks give comparison unavailable rather than zero", () => {
  const before = observation();
  const after = observation({ blockNumber: "43" });
  after.metadata.symbol = "BAD";
  const output = describeTokenComparison(before, after);
  assert.match(output, /比較不可/);
  assert.match(output, /最小単位の差: 不明/);
});

for (const stage of ["block", "code", "native", "metadata", "balance", "canonical", "complete"]) {
  test("known read stage has a finite local message: " + stage, () => {
    const text = tokenIdentityProgressMessage(stage);
    assert.ok(text.length > 4 && text.length < 100);
    assert.doesNotMatch(text, /100%|完了しました/);
  });
}
for (const value of [undefined, null, "", "__proto__", "constructor", "<img src=x>", "provider private secret"]) {
  test("unknown stages never echo provider text: " + String(value), () => {
    assert.equal(tokenIdentityProgressMessage(value), "");
  });
  test("unknown errors never echo provider text: " + String(value), () => {
    assert.equal(tokenIdentityErrorMessage(value),
      "照合を完了できませんでした。接続と入力を確認してください。");
  });
}

for (const code of ["IDENTITY_NOT_CONNECTED", "IDENTITY_CONTRACT_MISMATCH", "IDENTITY_CHECKSUM",
  "IDENTITY_FILE_SIZE", "IDENTITY_BLOCK_CHANGED", "IDENTITY_SESSION_CHANGED", "IDENTITY_TIMEOUT",
  "IDENTITY_DOWNLOAD", "IDENTITY_IMPORT_AGENT", "IDENTITY_STALE"]) {
  test("actionable finite message for " + code, () => {
    const output = tokenIdentityErrorMessage(code);
    assert.ok(output.length > 5);
    assert.ok(!output.includes(code));
    assert.notEqual(output, tokenIdentityErrorMessage("UNKNOWN"));
  });
}
