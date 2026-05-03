"use server";

import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { parsePdf } from "@/lib/python-api/client";
import type { ClassifiedLine, ParseResponse } from "@/lib/python-api/types";
import { logAction } from "@/lib/audit";

function parseJapaneseDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export async function uploadPdf(formData: FormData) {
  const supabase = createClient();
  const serviceClient = createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const file = formData.get("file") as File;
  if (!file || file.type !== "application/pdf") {
    throw new Error("PDFファイルを選択してください");
  }
  // 50MB上限（Storage バケット制限と一致）
  const MAX_FILE_SIZE = 50 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("ファイルサイズは50MBまでです");
  }
  // 日本語ファイル名のmojibake回避: クライアントから別フィールドで明示的にUTF-8文字列を受ける
  const originalFileName = (formData.get("originalFileName") as string) || file.name;

  // 対象月の手動指定（PDFの解析結果より優先）
  const overrideReportMonth = (formData.get("overrideReportMonth") as string) || null;
  if (overrideReportMonth && !/^\d{4}-\d{2}-\d{2}$/.test(overrideReportMonth)) {
    throw new Error("対象月の指定が不正です");
  }

  const { data: membership } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) throw new Error("組織が見つかりません");

  const orgId = membership.organization_id;
  const timestamp = Date.now();
  const safeFileName = file.name
    .replace(/[^\w.-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  const storageFileName = safeFileName.endsWith(".pdf") ? safeFileName : `${safeFileName}.pdf`;
  const storagePath = `${orgId}/${timestamp}_${storageFileName}`;

  const { error: storageError } = await serviceClient.storage
    .from("payment-notices")
    .upload(storagePath, file, { contentType: "application/pdf" });

  if (storageError) throw new Error(`ストレージエラー: ${storageError.message}`);

  const { data: notice, error: insertError } = await serviceClient
    .from("payment_notices")
    .insert({
      organization_id: orgId,
      file_name: originalFileName,
      storage_path: storagePath,
      report_month: overrideReportMonth ?? new Date().toISOString().slice(0, 7) + "-01",
      parse_status: "parsing",
      uploaded_by: user.id,
    })
    .select()
    .single();

  if (insertError || !notice) throw new Error("DBエラー: 記録の作成に失敗しました");

  await logAction(
    serviceClient,
    orgId,
    user.id,
    "payment_notice.upload",
    { type: "payment_notice", id: notice.id },
    {
      file_name: originalFileName,
      storage_path: storagePath,
      report_month: notice.report_month,
    }
  );

  try {
    const parsed: ParseResponse = await parsePdf(file, orgId);
    const isoPaymentDate = parseJapaneseDate(parsed.payment_date);

    const propertyInserts = parsed.properties.map((p) => ({
      organization_id: orgId,
      payment_notice_id: notice.id,
      property_name: p.property_name,
      contract_no: p.contract_no || null,
      work_summary: p.koji_label || null,
      amount_sales: p.amount_sales,
      amount_shaho: p.amount_shaho,
      amount_seisanka: p.amount_seisanka,
      amount_material: p.amount_materials,
      amount_tatekae: p.amount_tatekae ?? 0,
    }));

    let propertyIdByName: Map<string, string> = new Map();
    if (propertyInserts.length > 0) {
      const { data: insertedProps, error: propsError } = await serviceClient
        .from("properties")
        .insert(propertyInserts)
        .select("id, property_name");
      if (propsError) throw new Error(`物件挿入エラー: ${propsError.message}`);
      propertyIdByName = new Map(
        (insertedProps ?? []).map((p) => [p.property_name as string, p.id as string])
      );
    }

    // property_lines: 行レベル分類結果を保存（classification_confidence / method 含む）
    const lineInserts = (parsed.lines ?? [])
      .map((line: ClassifiedLine, idx: number) => {
        const propertyId = propertyIdByName.get(line.property_name);
        if (!propertyId) return null;
        return {
          organization_id: orgId,
          property_id: propertyId,
          work_type: line.work_type || "(未指定)",
          amount_excl_tax: line.amount_excl_tax,
          consumption_tax: line.consumption_tax,
          amount_incl_tax: line.amount_incl_tax,
          note: line.note || null,
          category: line.category,
          classification_confidence: line.classification_confidence,
          classification_method: line.classification_method,
          sort_order: idx,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    let insertedLineIds: { id: string; sort_order: number }[] = [];
    if (lineInserts.length > 0) {
      const { data: insertedLines, error: linesError } = await serviceClient
        .from("property_lines")
        .insert(lineInserts)
        .select("id, sort_order");
      if (linesError) {
        // 行レベル保存の失敗は致命的ではない（properties は保存済）。warn ログのみ。
        console.warn(`[upload] property_lines insert error: ${linesError.message}`);
      } else {
        insertedLineIds = insertedLines ?? [];
      }
    }

    // ai_classifications: AI 呼び出し履歴を保存（コスト追跡・監査用）
    if ((parsed.ai_classifications ?? []).length > 0) {
      const lineIdByIndex = new Map(
        insertedLineIds.map((l) => [l.sort_order as number, l.id as string])
      );
      const aiInserts = parsed.ai_classifications.map((rec) => ({
        organization_id: orgId,
        property_line_id: lineIdByIndex.get(rec.line_index) ?? null,
        prompt_input: rec.prompt_input as never, // Json 互換扱い
        ai_response: (rec.ai_response ?? null) as never,
        model: rec.model,
        input_tokens: rec.input_tokens,
        output_tokens: rec.output_tokens,
        latency_ms: rec.latency_ms,
        error: rec.error,
      }));
      const { error: aiError } = await serviceClient
        .from("ai_classifications")
        .insert(aiInserts);
      if (aiError) {
        console.warn(`[upload] ai_classifications insert error: ${aiError.message}`);
      }
    }

    const { error: updateError } = await serviceClient
      .from("payment_notices")
      .update({
        parse_status: "completed",
        payment_date: isoPaymentDate,
        transfer_amount: parsed.transfer_amount,
        offset_incl_tax: parsed.offset_amount,
        // 手動指定があればそれを優先、無ければ PDF 解析結果、それも無ければ初期値を維持
        report_month:
          overrideReportMonth ??
          (isoPaymentDate
            ? isoPaymentDate.slice(0, 7) + "-01"
            : notice.report_month),
      })
      .eq("id", notice.id);
    if (updateError) throw new Error(`通知更新エラー: ${updateError.message}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "解析失敗";
    await serviceClient
      .from("payment_notices")
      .update({ parse_status: "failed", parse_error: msg })
      .eq("id", notice.id);
  }

  redirect(`/preview/${notice.id}`);
}
