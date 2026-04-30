# 支払い通知書集計アプリ（Web版）

## このリポジトリについて

旭化成ホームズコンストラクションから毎月届く支払い通知書PDFを邸ごとに自動集計し、担当者別の粗利を可視化するWebアプリケーション。既存のWindowsデスクトップツール（[invoice-tool](https://github.com/RIKU0804/invoice-tool)）のWeb版・SaaS化を目指す。

## アーキテクチャの要点

- **Next.js (Vercel)** + **Python API (Railway)** の2サービス構成
- PDFパース・AI分類はPython側、UI・DB操作はTS側
- DBは**Supabase** (PostgreSQL + Auth + Storage)
- **ハイブリッドAI分類**：ルール優先＋確信度低い行はClaude APIで判定
- **マルチテナント前提**: 1社専用で開発するが、最初からテナント分離設計

## クイックリファレンス（Claude Codeへの指示）

**最初に必ず読むべきドキュメント（順番通りに）：**

1. [`01-architecture.md`](./01-architecture.md) - 技術スタック・全体構成
2. [`03-business-logic.md`](./03-business-logic.md) - **最重要**: 振り分けロジック
3. [`09-ai-classification.md`](./09-ai-classification.md) - AI分類機能の仕様
4. [`02-data-model.md`](./02-data-model.md) - DB設計
5. [`08-roadmap.md`](./08-roadmap.md) - フェーズ別タスク分解

**実装時に都度参照：**

- [`04-pdf-parsing.md`](./04-pdf-parsing.md) - PDFパース実装（pdfplumber）
- [`05-api-spec.md`](./05-api-spec.md) - エンドポイント定義
- [`06-ui-spec.md`](./06-ui-spec.md) - 画面・UX
- [`07-excel-export.md`](./07-excel-export.md) - Excel出力

**参考資料：**

- [`reference/invoice-tool-analysis.md`](./reference/invoice-tool-analysis.md) - 既存Pythonコードの解析
- [`reference/sample-data.md`](./reference/sample-data.md) - 検証用サンプルと期待値

## プロジェクトのゴール

### MVP（フェーズ1）
- 山本さんの会社で月次運用が回せる状態
- PDFアップロード→自動集計→担当者割り当て→ダッシュボード表示→Excel出力の一気通貫
- 既存のWindowsツールと同じ精度で集計できる
- **AI分類機能の組み込み**: ルール+AIのハイブリッド構成で、新しい備考表現にも自動適応

### フェーズ2以降（将来）
- 他の不動産会社にも展開（マルチテナントSaaS）
- 課金実装（プラン未定）
- AIルール提案機能（蓄積データから新ルールを自動提案）
- PDFフォーマット切替対応（旭化成以外）

## 重要な制約

### マルチテナント前提（最初から組み込む）
山本さんの会社専用で開発するが、**DB設計の段階からテナント分離を前提**にする。`organizations`テーブルを作り、すべてのデータに`organization_id`を持たせ、Supabase RLS（Row Level Security）でテナント間のデータを完全分離する。あとから差し込むのは現実的に不可能。

### 開発スタイル
- ユーザー（依頼者）は、Claudeが許可なく勝手に実装を進めることを好まない
- 実装着手前に必ず方針確認を取る
- 各フェーズの完了時にレビューを挟む

## 既存資産の活用方針

[invoice-tool](https://github.com/RIKU0804/invoice-tool) のPythonコード（pdfplumber + 振り分けロジック）を**Python APIサーバーで再利用**する。`reference/invoice-tool-analysis.md` に主要関数の解析を記載済み。

新しいPython APIは既存コードをベースにしつつ、以下を加える：
- マルチテナント対応（`organization_id`をすべての処理に渡す）
- AI分類（Claude API）の統合
- DBへの保存処理（Supabaseクライアント経由）
- FastAPI でREST APIとして公開

## 開発者へ

- このドキュメント群は依頼者（個人事業でAI導入支援をしている学生）から Claude Code への引き渡し用に作成された
- 不明点が出たら勝手に判断せず、依頼者に確認を取ること
- すべてのドキュメントは日本語で書かれているが、コード・コメントは原則英語でOK（変数名は日本語→英語のマッピングが業務用語に必要なら `02-data-model.md` の用語表を参照）
