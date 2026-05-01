"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { uploadPdf } from "@/app/actions/upload";

const PHASES: ReadonlyArray<{ label: string; minSeconds: number }> = [
  { label: "PDFをアップロード中...", minSeconds: 0 },
  { label: "PDFを読込中...", minSeconds: 5 },
  { label: "項目を抽出中...", minSeconds: 10 },
  { label: "AI分類中...", minSeconds: 15 },
  { label: "結果を保存中...", minSeconds: 25 },
];

function formatElapsed(seconds: number): string {
  const mm = Math.floor(seconds / 60).toString();
  const ss = (seconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function UploadPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 経過時間カウンタ：処理中のみ走らせる
  useEffect(() => {
    if (!isPending) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [isPending]);

  const currentPhase =
    [...PHASES].reverse().find((p) => elapsedSeconds >= p.minSeconds) ?? PHASES[0];

  function handleFile(file: File) {
    if (file.type !== "application/pdf") {
      setError("PDFファイルのみ対応しています");
      return;
    }
    setError(null);
    setSelectedFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleSubmit() {
    if (!selectedFile) return;
    setError(null);
    const formData = new FormData();
    formData.append("file", selectedFile);
    // ファイル名は別フィールドで明示的にUTF-8文字列として送る（multipart filename のmojibake回避）
    formData.append("originalFileName", selectedFile.name);
    startTransition(async () => {
      try {
        await uploadPdf(formData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "アップロードに失敗しました");
      }
    });
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold">PDFアップロード</h1>
        <p className="text-sm text-muted-foreground mt-1">支払通知書のPDFをアップロードして自動集計します</p>
      </div>

      <div
        className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
          isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
        }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        <div className="space-y-2">
          <div className="text-4xl">📄</div>
          {selectedFile ? (
            <>
              <p className="font-medium text-foreground">{selectedFile.name}</p>
              <p className="text-sm text-muted-foreground">
                {(selectedFile.size / 1024).toFixed(0)} KB
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">ここにPDFをドラッグ＆ドロップ</p>
              <p className="text-sm text-muted-foreground">またはクリックして選択</p>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={!selectedFile || isPending}
        className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>解析中...</span>
          </>
        ) : (
          "アップロードして解析"
        )}
      </button>

      {isPending && (
        <div
          className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-blue-700" aria-hidden="true" />
            <div className="flex-1">
              <p className="font-medium">{currentPhase.label}</p>
              <p className="mt-0.5 text-xs text-blue-700">
                {formatElapsed(elapsedSeconds)} 経過 ／ 通常30〜60秒程度かかります
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
