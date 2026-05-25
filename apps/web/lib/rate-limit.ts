/**
 * シンプルなインメモリ・トークンバケット (MEDIUM M3)
 *
 * 単一インスタンス想定の dev / Hobby デプロイ用の暫定実装。
 * 本番マルチインスタンスでは Redis (Upstash 等) ベースに置き換えること。
 *
 * TODO(production): @upstash/ratelimit + Upstash Redis に置き換える。
 *
 * 使い方:
 *   if (!consumeToken(`upload:${orgId}`, { capacity: 20, refillPerHour: 20 })) {
 *     throw new Error("一定時間内のアップロード回数を超えました");
 *   }
 */

type Bucket = {
  tokens: number;
  lastRefill: number;
};

const buckets = new Map<string, Bucket>();

export type BucketConfig = {
  /** バケットの最大トークン数 */
  capacity: number;
  /** 1 時間あたりの再充填トークン数 */
  refillPerHour: number;
};

/**
 * トークンを 1 つ消費する。利用可能であれば true、レート上限超過なら false。
 *
 * 副作用: 古い lastRefill から経過時間に応じて補充してから 1 つ消費する。
 */
export function consumeToken(key: string, config: BucketConfig): boolean {
  const now = Date.now();
  const refillPerMs = config.refillPerHour / (60 * 60 * 1000);

  const existing = buckets.get(key);
  if (!existing) {
    buckets.set(key, { tokens: config.capacity - 1, lastRefill: now });
    return true;
  }

  const elapsed = now - existing.lastRefill;
  const refilled = Math.min(
    config.capacity,
    existing.tokens + elapsed * refillPerMs
  );
  if (refilled < 1) {
    existing.tokens = refilled;
    existing.lastRefill = now;
    return false;
  }
  existing.tokens = refilled - 1;
  existing.lastRefill = now;
  return true;
}
