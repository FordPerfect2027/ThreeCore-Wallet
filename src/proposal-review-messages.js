export const PROPOSAL_REVIEW_REASONS = Object.freeze({
  POLICY_CONTEXT_MISMATCH:"提案と使用条件のトークン・口座・ネットワークが一致しません。", DAPP_NOT_ALLOWED:"対象dAppのURLと契約アドレスの組が使用条件にありません。",
  PROPOSAL_NOT_YET_VALID:"提案の開始時刻前です。", PROPOSAL_EXPIRED:"提案の期限を過ぎています。", POLICY_NOT_YET_VALID:"使用条件の開始時刻前です。", POLICY_EXPIRED:"使用条件の期限を過ぎています。",
  PROPOSAL_OUTSIDE_POLICY_WINDOW:"提案の有効期間が使用条件の期間を超えています。", PROPOSAL_LIFETIME_EXCEEDED:"提案の有効期間が長すぎます。",
  ZERO_TOKEN_SPEND:"提案のトークン使用額がゼロです。", TOKEN_SPEND_LIMIT:"トークン使用額が上限を超えています。", NATIVE_VALUE_LIMIT:"ETH使用額が上限を超えています。",
  BUDGET_SOURCE_INCONSISTENT:"予算と元の残高記録に不一致・不足があります。", BUDGET_CONSTRAINTS_UNSATISFIED:"予算に不足または未確認の項目があります。共有口座では合計費用も確認します。",
  PROPOSAL_SOURCE_MISSING:"提案に対応する予算・残高記録がありません。", PROPOSAL_SOURCE_CONTEXT_MISMATCH:"提案と残高記録の口座・ネットワーク・トークンが一致しません。",
  PROPOSAL_BUDGET_MISMATCH:"提案の使用額またはネットワークが予算と一致しません。", FEE_BUDGET_UNKNOWN:"未確認の手数料があります。", FEE_BUDGET_LIMIT:"手数料の予算が上限を超えています。"
});
