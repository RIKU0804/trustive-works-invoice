import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fmtJpy } from "@/lib/format";
import { ParsingPoller } from "./ParsingPoller";
import { FailedNoticeActions } from "./FailedNoticeActions";

const LOW_CONFIDENCE_THRESHOLD = 0.7;

const CATEGORY_LABEL: Record<string, string> = {
  sales: "売上",
  shaho: "社保",
  seisanka: "精算",
  material: "材料",
};

const METHOD_LABEL: Record<string, string> = {
  rule: "ルール判定",
  ai: "AI判定",
  manual: "手動修正",
};

const METHOD_BADGE_CLASS: Record<string, string> = {
  rule: "bg-slate-100 text-slate-700 border-slate-200",
  ai: "bg-violet-100 text-violet-700 border-violet-200",
  manual: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

export default async function PreviewPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: membership } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) notFound();

  const { data: notice } = await supabase
    .from("payment_notices")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", membership.organization_id)
    .single();

  if (!notice) notFound();

  const { data: properties } = await supabase
    .from("properties")
    .select("*, staff_members(name)")
    .eq("payment_notice_id", params.id)
    .eq("organization_id", membership.organization_id)
    .order("property_name");

  const propertyIds = (properties ?? []).map((p) => p.id);
  const { data: lines } = propertyIds.length
    ? await supabase
        .from("property_lines")
        .select("id, property_id, work_type, amount_excl_tax, note, category, classification_confidence, classification_method, sort_order")
        .in("property_id", propertyIds)
        .order("sort_order")
    : { data: [] as Array<{
        id: string;
        property_id: string;
        work_type: string;
        amount_excl_tax: number;
        note: string | null;
        category: string;
        classification_confidence: number | null;
        classification_method: string | null;
        sort_order: number;
      }> };

  const linesByProperty = new Map<string, typeof lines>();
  for (const line of lines ?? []) {
    const arr = linesByProperty.get(line.property_id) ?? [];
    arr.push(line);
    linesByProperty.set(line.property_id, arr);
  }

  const lowConfidenceCount = (lines ?? []).filter(
    (l) => (l.classification_confidence ?? 1) < LOW_CONFIDENCE_THRESHOLD
  ).length;

  const statusLabel: Record<string, string> = {
    pending: "待機中",
    parsing: "解析中",
    completed: "完了",
    failed: "失敗",
  };

  const statusColor: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    parsing: "bg-blue-100 text-blue-800",
    completed: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{notice.file_name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            アップロード: {new Date(notice.uploaded_at).toLocaleString("ja-JP")}
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor[notice.parse_status]}`}
        >
          {statusLabel[notice.parse_status]}
        </span>
      </div>

      {notice.parse_status === "failed" && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive space-y-3">
          <div>
            <div className="font-medium">解析に失敗しました</div>
            <div className="mt-1 text-destructive/80">
              {notice.parse_error
                ? notice.parse_error
                : "PDFの形式を確認し、再アップロードを試してください。"}
            </div>
          </div>
          <FailedNoticeActions noticeId={notice.id} fileName={notice.file_name} />
        </div>
      )}

      {notice.parse_status === "parsing" && <ParsingPoller />}

      {notice.parse_status === "completed" && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">支払日</p>
              <p className="mt-1 text-lg font-semibold">{notice.payment_date ?? "—"}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">振込金額</p>
              <p className="mt-1 text-lg font-semibold">{fmtJpy(notice.transfer_amount)}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">相殺金額（税込）</p>
              <p className="mt-1 text-lg font-semibold">{fmtJpy(notice.offset_incl_tax)}</p>
            </div>
          </div>

          {lowConfidenceCount > 0 && (
            <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-700" aria-hidden="true" />
              <div>
                <span className="font-medium">要確認:</span>{" "}
                信頼度が低い行が <span className="font-semibold">{lowConfidenceCount}</span> 件あります。下の明細でハイライトされた行を確認してください。
              </div>
            </div>
          )}

          <div>
            <a
              href={`/api/payment-notices/${notice.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
            >
              PDFをダウンロード
            </a>
          </div>

          <div>
            <h2 className="text-sm font-semibold mb-3">物件一覧（{properties?.length ?? 0}件）</h2>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">物件名</th>
                    <th className="px-3 py-2 text-center font-medium">班長</th>
                    <th className="px-3 py-2 text-right font-medium">売上</th>
                    <th className="px-3 py-2 text-right font-medium">社保</th>
                    <th className="px-3 py-2 text-right font-medium">精算額</th>
                    <th className="px-3 py-2 text-right font-medium">材料</th>
                    <th className="px-3 py-2 text-right font-medium">粗利</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {properties?.map((p) => {
                    const staffName =
                      (p as { staff_members?: { name: string } | null }).staff_members?.name ?? "";
                    return (
                      <tr key={p.id} className="hover:bg-muted/30">
                        <td className="px-3 py-2">{p.property_name}</td>
                        <td className="px-3 py-2 text-center">
                          {staffName || <span className="text-red-500 text-xs">未</span>}
                        </td>
                        <td className="px-3 py-2 text-right">{fmtJpy(p.amount_sales)}</td>
                        <td className="px-3 py-2 text-right">{fmtJpy(p.amount_shaho)}</td>
                        <td className="px-3 py-2 text-right">{fmtJpy(p.amount_seisanka)}</td>
                        <td className="px-3 py-2 text-right">{fmtJpy(p.amount_material)}</td>
                        <td className="px-3 py-2 text-right font-medium">{fmtJpy(p.amount_gross_profit)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {(lines?.length ?? 0) > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">明細行（{lines?.length}件）</h2>
                <div className="text-xs text-muted-foreground">
                  信頼度 &lt; {LOW_CONFIDENCE_THRESHOLD} の行は黄色でハイライトされます
                </div>
              </div>
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium w-8"></th>
                      <th className="px-3 py-2 text-left font-medium">物件</th>
                      <th className="px-3 py-2 text-left font-medium">工種</th>
                      <th className="px-3 py-2 text-right font-medium">税抜額</th>
                      <th className="px-3 py-2 text-left font-medium">備考</th>
                      <th className="px-3 py-2 text-left font-medium">区分</th>
                      <th className="px-3 py-2 text-left font-medium">判定</th>
                      <th className="px-3 py-2 text-right font-medium">信頼度</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {properties?.flatMap((p) =>
                      (linesByProperty.get(p.id) ?? []).map((line) => {
                        const conf = line.classification_confidence ?? 1;
                        const method = (line.classification_method ?? "rule") as keyof typeof METHOD_LABEL;
                        const isLow = conf < LOW_CONFIDENCE_THRESHOLD;
                        return (
                          <tr
                            key={line.id}
                            className={
                              isLow
                                ? "bg-amber-50 hover:bg-amber-100"
                                : "hover:bg-muted/30"
                            }
                            title={`${METHOD_LABEL[method] ?? method}: 信頼度 ${(conf * 100).toFixed(0)}%`}
                          >
                            <td className="px-3 py-2 text-center">
                              {isLow ? (
                                <AlertTriangle
                                  className="w-4 h-4 inline text-amber-600"
                                  aria-label="要確認"
                                />
                              ) : (
                                ""
                              )}
                            </td>
                            <td className="px-3 py-2">{p.property_name}</td>
                            <td className="px-3 py-2">{line.work_type}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {fmtJpy(line.amount_excl_tax)}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{line.note ?? ""}</td>
                            <td className="px-3 py-2">{CATEGORY_LABEL[line.category] ?? line.category}</td>
                            <td className="px-3 py-2">
                              <span
                                className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${
                                  METHOD_BADGE_CLASS[method] ?? METHOD_BADGE_CLASS.rule
                                }`}
                              >
                                {METHOD_LABEL[method] ?? method}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {(conf * 100).toFixed(0)}%
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
