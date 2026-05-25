/**
 * 構造化ロガー (MEDIUM M7)
 *
 * console.error/.warn を直接散らかさず、JSON 1 行 / イベント名 + フィールドの
 * 形式でログを出力する薄いラッパ。pino を入れるかは未定なので、まずは
 * 標準出力に JSON を吐く実装に統一しておく。
 *
 * 利用例:
 *   logger.error("upload_failed", { reason: e.message, orgId })
 *   logger.warn("storage_remove_failed", { path })
 *   logger.info("member_invited", { email })
 */

type Fields = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", event: string, fields: Fields = {}) {
  const payload = {
    level,
    event,
    ts: new Date().toISOString(),
    ...fields,
  };
  // 構造化ログは 1 行 JSON で stdout/stderr に出す
  if (level === "error" || level === "warn") {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(payload));
  } else {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
  }
}

export const logger = {
  info: (event: string, fields?: Fields) => emit("info", event, fields),
  warn: (event: string, fields?: Fields) => emit("warn", event, fields),
  error: (event: string, fields?: Fields) => emit("error", event, fields),
};
