// Distribute properties among staff members for demo data.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env.local");
const env = Object.fromEntries(
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

// service_role キーで RLS を無視するデモ用スクリプト。本番 URL への
// 誤実行を防ぐためローカル/プライベート宛先のみ許可する。
function assertLocalTarget(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    console.error(`不正な SUPABASE_URL: ${url}`);
    process.exit(1);
  }
  const localOk =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "host.docker.internal" ||
    host.endsWith(".local") ||
    host.startsWith("192.168.") ||
    host.startsWith("10.");
  if (!localOk && env.ALLOW_REMOTE_SEED !== "1") {
    console.error(
      `[安全装置] 非ローカルの SUPABASE_URL (${host}) への seed を拒否しました。\n` +
        `本当に実行する場合のみ ALLOW_REMOTE_SEED=1 を設定してください。`
    );
    process.exit(1);
  }
}

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です");
  process.exit(1);
}
assertLocalTarget(env.NEXT_PUBLIC_SUPABASE_URL);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const ORG_ID = env.IMPORT_ORG_ID || "a1b2c3d4-0000-0000-0000-000000000001";

const { data: staff } = await supabase
  .from("staff_members")
  .select("id, name")
  .eq("organization_id", ORG_ID)
  .order("display_order");

const { data: properties } = await supabase
  .from("properties")
  .select("id, property_name")
  .eq("organization_id", ORG_ID);

console.log(`Distributing ${properties.length} properties across ${staff.length} staff (~70% assignment rate)`);

let assignedCount = 0;
for (const prop of properties) {
  // 70% chance of assignment for realistic demo
  if (Math.random() < 0.7) {
    const staffMember = staff[Math.floor(Math.random() * staff.length)];
    await supabase
      .from("properties")
      .update({ staff_member_id: staffMember.id })
      .eq("id", prop.id);
    assignedCount++;
  }
}

console.log(`Assigned ${assignedCount} / ${properties.length} properties`);

// Add a sample memo for the most recent month
const { error: memoError } = await supabase
  .from("monthly_memos")
  .upsert({
    organization_id: ORG_ID,
    report_month: "2025-12-01",
    content: "12月分: 年末の繁忙期。担当者の確認をお願いします。\n材料費が前月比10%増加しています。",
  }, { onConflict: "organization_id,report_month" });

if (memoError) {
  console.error("memo error:", memoError.message);
} else {
  console.log("Sample memo added for 2025-12");
}
