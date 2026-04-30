"use client";

interface ExportFormProps {
  months: string[];
}

export function ExportForm({ months }: ExportFormProps) {
  const handleDownload = (month: string, format: "xlsx" | "csv") => {
    window.open(`/api/export?month=${month}&format=${format}`, "_blank");
  };

  if (months.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <p className="text-sm text-muted-foreground">出力可能なデータがありません</p>
        <p className="text-xs text-muted-foreground mt-1">
          PDFをアップロードして解析を完了してください
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium">対象月</th>
            <th className="px-4 py-3 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {months.map((month) => (
            <tr key={month} className="hover:bg-muted/30">
              <td className="px-4 py-3">
                {month.replace(/^(\d{4})-(\d{2})$/, "$1年$2月")}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="inline-flex items-center gap-2">
                  <button
                    onClick={() => handleDownload(month, "xlsx")}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Excelダウンロード
                  </button>
                  <button
                    onClick={() => handleDownload(month, "csv")}
                    className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted/50 transition-colors"
                  >
                    CSVダウンロード
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
