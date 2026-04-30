// Bulk-import PDF payment notices via service role.
// Usage: node scripts/bulk-import.mjs <directory>
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

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const PYTHON_API_URL = env.PYTHON_API_URL || "http://localhost:8001";
const PYTHON_API_KEY = env.PYTHON_API_KEY || "dev-secret-key";
const ORG_ID = "a1b2c3d4-0000-0000-0000-000000000001";
const dir = process.argv[2];

if (!dir) {
  console.error("Usage: node scripts/bulk-import.mjs <directory>");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function parseJpDate(s) {
  if (!s) return null;
  const m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function safeName(name) {
  return name.replace(/[^\w.-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

async function getOrCreateBotUser() {
  const { data: users } = await supabase.auth.admin.listUsers();
  const bot = users?.users?.find((u) => u.email === "bot@local.dev");
  if (bot) return bot.id;

  const { data, error } = await supabase.auth.admin.createUser({
    email: "bot@local.dev",
    password: "bot-password-12345",
    email_confirm: true,
  });
  if (error) throw new Error(`bot create failed: ${error.message}`);

  // Manually insert into public.users (since trigger may not fire)
  await supabase.from("users").upsert({
    id: data.user.id,
    email: "bot@local.dev",
    display_name: "Bot",
  });
  await supabase.from("memberships").upsert({
    user_id: data.user.id,
    organization_id: ORG_ID,
    role: "owner",
  });
  return data.user.id;
}

async function importOne(filePath, uploadedBy) {
  const fileName = path.basename(filePath);
  console.log(`\n[${fileName}]`);
  const buf = fs.readFileSync(filePath);

  // 1. Upload to storage
  const ts = Date.now();
  const safe = safeName(fileName);
  const storagePath = `${ORG_ID}/${ts}_${safe}`;
  const { error: storageError } = await supabase.storage
    .from("payment-notices")
    .upload(storagePath, buf, { contentType: "application/pdf", upsert: false });
  if (storageError) {
    console.error(`  storage error: ${storageError.message}`);
    return false;
  }
  console.log(`  ✓ uploaded to storage`);

  // 2. Insert payment_notices
  const { data: notice, error: insertError } = await supabase
    .from("payment_notices")
    .insert({
      organization_id: ORG_ID,
      file_name: fileName,
      storage_path: storagePath,
      report_month: new Date().toISOString().slice(0, 7) + "-01",
      parse_status: "parsing",
      uploaded_by: uploadedBy,
    })
    .select()
    .single();
  if (insertError) {
    console.error(`  insert error: ${insertError.message}`);
    return false;
  }

  // 3. Call Python API
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "application/pdf" }), safe);
  let parsed;
  try {
    const res = await fetch(`${PYTHON_API_URL}/pdf/parse`, {
      method: "POST",
      headers: { "X-API-Key": PYTHON_API_KEY, "X-Organization-Id": ORG_ID },
      body: form,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err}`);
    }
    parsed = await res.json();
  } catch (e) {
    console.error(`  parse error: ${e.message}`);
    await supabase.from("payment_notices")
      .update({ parse_status: "failed", parse_error: e.message })
      .eq("id", notice.id);
    return false;
  }

  console.log(`  ✓ parsed ${parsed.properties.length} properties (raw rows: ${parsed.raw_row_count})`);

  // 4. Insert properties
  const isoDate = parseJpDate(parsed.payment_date);
  if (parsed.properties.length > 0) {
    const inserts = parsed.properties.map((p) => ({
      organization_id: ORG_ID,
      payment_notice_id: notice.id,
      property_name: p.property_name,
      contract_no: p.contract_no || null,
      work_summary: p.koji_label || null,
      amount_sales: p.amount_sales,
      amount_shaho: p.amount_shaho,
      amount_seisanka: p.amount_seisanka,
      amount_material: p.amount_materials,
    }));
    const { error: propsError } = await supabase.from("properties").insert(inserts);
    if (propsError) {
      console.error(`  properties insert error: ${propsError.message}`);
      await supabase.from("payment_notices")
        .update({ parse_status: "failed", parse_error: propsError.message })
        .eq("id", notice.id);
      return false;
    }
  }

  // 5. Finalize notice
  const { error: updateError } = await supabase
    .from("payment_notices")
    .update({
      parse_status: "completed",
      payment_date: isoDate,
      transfer_amount: parsed.transfer_amount,
      offset_incl_tax: parsed.offset_amount,
      report_month: isoDate ? isoDate.slice(0, 7) + "-01" : notice.report_month,
    })
    .eq("id", notice.id);
  if (updateError) {
    console.error(`  update error: ${updateError.message}`);
    return false;
  }

  console.log(`  ✅ completed (${isoDate}, ¥${parsed.transfer_amount?.toLocaleString()})`);
  return true;
}

async function main() {
  const uploadedBy = await getOrCreateBotUser();
  console.log(`bot user: ${uploadedBy}`);

  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
  console.log(`found ${files.length} PDFs`);

  let ok = 0, fail = 0;
  for (const f of files) {
    const result = await importOne(path.join(dir, f), uploadedBy);
    if (result) ok++; else fail++;
  }

  console.log(`\n=== Done: ${ok} succeeded, ${fail} failed ===`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
