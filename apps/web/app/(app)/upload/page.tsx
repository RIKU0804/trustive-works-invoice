"use client";

import { useRef, useState, useTransition } from "react";
import { uploadPdf } from "@/app/actions/upload";

export default function UploadPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

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
        className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
      >
        {isPending ? "解析中..." : "アップロードして解析"}
      </button>

      {isPending && (
        <p className="text-center text-sm text-muted-foreground">
          PDFを解析しています。しばらくお待ちください...
        </p>
      )}
    </div>
  );
}
