import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Inbox, Upload } from "lucide-react";
import { SearchButton } from "./SearchButton";
import { fmtJpy } from "@/lib/format";

type SupabaseAny = ReturnType<typeof createClient>;

interface KpiCard {
  label: string;
  value: number;
  grossProfit: number;
  grossProfitRate: number;
  propertyCount: number;
  delta: number | null;
  deltaPct: number | null;
  compareLabel: string;
  subtitle?: string;
}

async function computeKpis(
  supabase: SupabaseAny,
  orgId: string,
  notices: Array<{ report_month: string | null; transfer_amount: number | null }>
): Promise<{ cards: KpiCard[] }> {
  const months = Array.from(
    new Set(
      notices
        .map((n) => (n.report_month ? String(n.report_month).slice(0, 7) : null))
        .filter((x): x is string => !!x)
    )
  ).sort()
    .reverse();

  if (months.length === 0) return { cards: [] };

  const latest = months[0];
  const prev = months[1] ?? null;
  const yearAgo = (() => {
    const [y, m] = latest.split("-");
    return `${parseInt(y) - 1}-${m}`;
  })();
  const yearAgoExists = months.includes(yearAgo);

  async function summarize(monthYM: string) {
    const monthStart = `${monthYM}-01`;
    const { data: rows } = await supabase
      .from("properties")
      .select(`
        amount_sales,
        amount_gross_profit,
        payment_notices!inner(report_month)
      `)
      .eq("organization_id", orgId)
      .eq("payment_notices.report_month", monthStart);
    const sales = (rows ?? []).reduce(
      (s, p) => s + Number((p as { amount_sales: number | null }).amount_sales ?? 0),
      0
    );
    const grossProfit = (rows ?? []).reduce(
      (s, p) => s + Number((p as { amount_gross_profit: number | null }).amount_gross_profit ?? 0),
      0
    );
    return { sales, grossProfit, count: rows?.length ?? 0 };
  }

  const [latestSum, prevSum, yearAgoSum] = await Promise.all([
    summarize(latest),
    prev ? summarize(prev) : Promise.resolve(null),
    yearAgoExists ? summarize(yearAgo) : Promise.resolve(null),
  ]);

  const card = (
    label: string,
    sum: { sales: number; grossProfit: number; count: number },
    compare: { sales: number; grossProfit: number; count: number } | null,
    compareLabel: string,
    subtitle?: string
  ): KpiCard => ({
    label,
    value: sum.sales,
    grossProfit: sum.grossProfit,
    grossProfitRate: sum.sales > 0 ? (sum.grossProfit / sum.sales) * 100 : 0,
    propertyCount: sum.count,
    delta: compare ? sum.sales - compare.sales : null,
    deltaPct:
      compare && compare.sales > 0
        ? ((sum.sales - compare.sales) / compare.sales) * 100
        : null,
    compareLabel,
    subtitle,
  });

  const cards: KpiCard[] = [
    card(`${latest.replace("-", "年")}月（最新）`, latestSum, prevSum, "前月", prev ? undefined : "前月データなし"),
  ];
  if (prev && prevSum) {
    cards.push(card(`${prev.replace("-", "年")}月`, prevSum, null, "", "前月実績"));
  }
  if (yearAgoSum) {
    cards.push(card(`${yearAgo.replace("-", "年")}月（前年同月）`, yearAgoSum, null, "", "前年同月"));
  }
  return { cards };
}

export default async function DashboardPage() {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();

  const { data: membership } = user
    ? await supabase
        .from("memberships")
        .select("organization_id")
        .eq("user_id", user.id)
        .single()
    : { data: null };

  const orgId = membership?.organization_id;

  const { data: notices } = orgId
    ? await supabase
        .from("payment_notices")
        .select("*")
        .eq("organization_id", orgId)
        .order("report_month", { ascending: false })
        .order("uploaded_at", { ascending: false })
        .limit(50)
    : { data: [] };

  // KPI: 最新月 / 前月 / 前年同月 のサマリ
  const kpis = orgId
    ? await computeKpis(supabase, orgId, notices ?? [])
    : null;

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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">ダッシュボード</h1>
        <div className="flex items-center">
          <SearchButton />
          <Link
          href="/upload"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + PDFアップロード
        </Link>
        </div>
      </div>

      {kpis && kpis.cards.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {kpis.cards.map((c) => (
            <div
              key={c.label}
              className="rounded-lg border bg-white p-4 hover:border-primary/30 transition-colors"
            >
              <div className="text-xs text-muted-foreground">{c.label}</div>
              <div className="mt-1 text-xl font-bold tabular-nums">
                {fmtJpy(c.value)}
              </div>
              <div className="text-[11px] mt-1">
                {c.delta != null && c.deltaPct != null ? (
                  <span
                    className={
                      c.delta > 0
                        ? "text-green-600"
                        : c.delta < 0
                        ? "text-red-600"
                        : "text-muted-foreground"
                    }
                  >
                    {c.delta > 0 ? "▲" : c.delta < 0 ? "▼" : ""}{" "}
                    {Math.abs(c.deltaPct).toFixed(1)}% ({c.compareLabel}比)
                  </span>
                ) : (
                  <span className="text-muted-foreground">{c.subtitle}</span>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                粗利: {fmtJpy(c.grossProfit)} ({c.grossProfitRate.toFixed(1)}%) ·{" "}
                {c.propertyCount}邸
              </div>
            </div>
          ))}
        </div>
      )}

      {!notices || notices.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-white p-12">
          <div className="max-w-md mx-auto text-center space-y-4">
            <Inbox
              className="w-12 h-12 mx-auto text-muted-foreground"
              aria-hidden="true"
            />
            <div>
              <h2 className="text-base font-semibold">
                支払通知書がまだありません
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                PDFをアップロードすると自動で物件・粗利を集計します。
              </p>
            </div>

            <ol className="text-left text-sm text-muted-foreground space-y-2 mx-auto max-w-xs">
              <li className="flex gap-2">
                <span className="font-semibold text-foreground">1.</span>
                <span>支払通知書のPDFを準備</span>
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-foreground">2.</span>
                <span>右下のボタンからアップロード</span>
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-foreground">3.</span>
                <span>自動で物件・粗利を集計</span>
              </li>
            </ol>

            <Link
              href="/upload"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Upload className="w-4 h-4" aria-hidden="true" />
              PDFをアップロードする
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium">ファイル名</th>
                <th className="px-4 py-3 text-left font-medium">対象月</th>
                <th className="px-4 py-3 text-right font-medium">振込金額</th>
                <th className="px-4 py-3 text-left font-medium">ステータス</th>
                <th className="px-4 py-3 text-left font-medium">アップロード日</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {notices.map((n) => (
                <tr key={n.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{n.file_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{n.report_month}</td>
                  <td className="px-4 py-3 text-right">{fmtJpy(n.transfer_amount)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor[n.parse_status]}`}>
                      {statusLabel[n.parse_status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(n.uploaded_at).toLocaleDateString("ja-JP")}
                  </td>
                  <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                    {n.parse_status === "completed" && n.report_month && (
                      <Link
                        href={`/month/${String(n.report_month).slice(0, 7)}`}
                        className="text-primary text-xs hover:underline font-medium"
                      >
                        月詳細
                      </Link>
                    )}
                    <Link
                      href={n.parse_status === "completed" ? `/assign/${n.id}` : `/preview/${n.id}`}
                      className="text-primary text-xs hover:underline"
                    >
                      {n.parse_status === "completed" ? "割当" : "詳細"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
