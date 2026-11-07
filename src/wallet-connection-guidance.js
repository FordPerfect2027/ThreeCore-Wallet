import { normalizeAddress } from "./wallet-session.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Validate this card without making another card's unfinished input a blocker. */
export function validateConnectionAccount(account, otherAccounts = []) {
  const normalized = normalizeAddress(account);
  if (!Array.isArray(otherAccounts) || otherAccounts.length > 2) {
    throw Object.assign(new Error("Invalid card assignments"), { code: "INVALID_ASSIGNMENTS" });
  }
  for (const other of otherAccounts) {
    if (typeof other === "string" && ADDRESS.test(other) && other.toLowerCase() === normalized) {
      throw Object.assign(new Error("Duplicate card account"), { code: "DUPLICATE_ACCOUNT" });
    }
  }
  return normalized;
}

/** Local guidance only. Never quote wallet-supplied prose or infer its account. */
export function walletConnectionGuidance(code, { agent, account, chainId } = {}) {
  const name = ["DAT", "EMA", "CAWELON"].includes(agent) ? agent : "このカード";
  const assigned = typeof account === "string" && ADDRESS.test(account)
    ? "\n" + name + "の設定アドレス: " + account.toLowerCase() : "";
  switch (code) {
    case "INVALID_ADDRESS":
      return "「このエージェントのWallet公開アドレス」に、0xから始まる42文字の公開アドレスを入力してください。途中が省略された表示は使えません。秘密鍵やシードフレーズは入力しないでください。";
    case "DUPLICATE_ACCOUNT":
      return "別のエージェントと同じ公開アドレスが設定されています。DAT・EMA・CAWELONにはそれぞれ別のアドレスを設定してください。";
    case "WRONG_ACCOUNT":
      return "Walletがこのサイトに渡したアカウントと、" + name + "の設定アドレスが一致しません。" + assigned +
        "\nWallet画面で選んだアカウントだけでなく、このサイトへの接続許可も確認してください。意図したアドレスであることを確認してから再接続してください。設定アドレスは自動変更しません。";
    case "NO_ACCOUNTS":
    case 4100:
      return "Walletからこのサイトで利用できるアカウントを確認できません。Wallet側の接続許可で、意図したアカウントとこのサイトを確認してから再接続してください。";
    case "WRONG_CHAIN": {
      const chain = chainId === 8453 ? "Base Mainnet（8453）" :
        chainId === 84532 ? "Base Sepolia（84532）" : "このカードに設定したチェーン";
      return "Walletのチェーンが設定と一致しません。接続先は" + chain +
        "です。Wallet側のチェーンを確認してから再接続してください。チェーンを自動で切り替えたり、資金を移したりはしません。";
    }
    case "NO_PROVIDER":
      return "選択したWalletを利用できません。「接続するWallet」の選択とWallet拡張機能の状態を確認してください。";
    case "INVALID_CHAIN":
    case "UNSUPPORTED_CHAIN":
      return "対応するチェーンを確認できません。Base MainnetまたはBase Sepoliaの設定を確認してください。自動で別の接続先へ切り替えません。";
    case "ACCOUNT_CHANGED":
      return "Walletがこのサイトに渡すアカウントが変わったため、接続を停止しました。設定アドレスと接続許可を確認してから再接続してください。";
    default:
      return null;
  }
}
