import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { ensureAuthenticatedStorageState } from "./auth";

const STORAGE_PATH = resolve(__dirname, "..", ".auth", "user.json");

export default async function globalSetup() {
  // .env.local をロード（Playwright は Next.js のように自動ロードしない）
  loadEnv({ path: resolve(__dirname, "..", "..", "..", ".env.local") });

  await ensureAuthenticatedStorageState(STORAGE_PATH);
}
