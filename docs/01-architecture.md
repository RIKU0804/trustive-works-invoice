# 01. アーキテクチャ・技術スタック

## 全体構成

```
┌──────────────────────────────────────────────────────┐
│  ブラウザ (Next.js Frontend - React)                  │
└──────────────┬───────────────────────────────────────┘
               │ HTTPS
┌──────────────▼───────────────────────────────────────┐
│  Vercel (Next.js App)                                │
│  ├─ App Router (UI)                                  │
│  ├─ Server Actions / Route Handlers                  │
│  ├─ Excel出力 (ExcelJS)                              │
│  └─ DB操作・認証                                      │
└──────┬───────────────────────────────────┬───────────┘
       │                                   │
       │ HTTPS                             │
┌──────▼───────────────────────┐  ┌────────▼──────────┐
│ Python API (Railway/Render)  │  │  Supabase         │
│ ├─ FastAPI                    │  │  ├─ PostgreSQL    │
│ ├─ pdfplumber (PDFパース)     │  │  ├─ Storage       │
│ ├─ Claude API (AI分類)        │  │  └─ Auth + RLS    │
│ └─ 既存invoice-toolロジック流用│  └───────────────────┘
└───────────────────────────────┘
```

## 技術選定

### フロントエンド・アプリ層（Vercel）

| 領域 | 技術 | 理由 |
|---|---|---|
| フロントエンド | Next.js 14+ (App Router) + TypeScript | Vercel最適、SSR、Server Actions |
| UIフレームワーク | Tailwind CSS + shadcn/ui | 高速開発、一貫したUI |
| グラフ | Recharts | Reactネイティブで軽量 |
| 認証 | Supabase Auth (Google OAuth) | 簡単、無料枠で始められる |
| DB | Supabase (PostgreSQL) | RLSが強力、認証とSet |
| ファイル | Supabase Storage | DB同居 |
| Excel出力 | ExcelJS | テンプレート読込・書式付き出力対応 |
| バリデーション | Zod | TypeScript親和性 |
| デプロイ | Vercel | Next.js最適 |

### Python API層（Railway / Render / Fly.io）

| 領域 | 技術 | 理由 |
|---|---|---|
| Webフレームワーク | FastAPI | 軽量、型安全、自動ドキュメント |
| PDFパース | pdfplumber | **既存invoice-toolで実証済み** |
| AI分類 | anthropic (Python SDK) | Claude API公式 |
| 認証検証 | Supabase JWT検証 | Next.jsから来るリクエストを検証 |
| デプロイ | Railway or Render | Python対応、安価、Docker対応 |

## なぜPythonとTypeScriptの分離なのか

最初は「TS一体型」を検討していたが、以下の理由で**分離構成に変更**：

### 分離する理由

1. **既存invoice-toolのコードを最大限活用**：pdfplumberはPython専用。既に本番運用で精度が実証されているコードをわざわざTSに書き直すリスクが大きい。
2. **AIエコシステムがPython優位**：langchain、anthropic-sdk-python、各種ベクトルDB、機械学習ライブラリなど、AI周辺はPython最強。
3. **PDFパースの安定性**：pdfjs-distはブラウザ用、Node環境では動くが座標解析のバグや日本語フォントのトラブルが多い。pdfplumberは安定。
4. **責務分離**：UIとデータ処理を別サービスにすることで、それぞれ独立してデプロイ・スケールできる。

### 分離のデメリットと対処

| デメリット | 対処 |
|---|---|
| 2サービス運用が必要 | Railwayなら自動デプロイ・無料枠あり、運用負荷は低い |
| API通信のレイテンシー | PDF処理は元々重いのでレイテンシーは無視できる |
| 認証の二重管理 | Supabase JWTを共通の認証基盤として使う |

## デプロイ先候補

### Python API のホスティング

| サービス | 月額無料枠 | 特徴 |
|---|---|---|
| **Railway** | $5/月のクレジット | 推奨。GitHub連携で自動デプロイ、シンプル |
| Render | Free Tier（スリープあり） | 無料だが15分でスリープ＝初回起動遅い |
| Fly.io | 一定無料枠 | Docker前提、設定が少し複雑 |
| Modal | $30/月クレジット | サーバーレス Python、AI向き |

**MVPの推奨**: Railway。シンプルで日本からも速い。

## 環境変数

### Vercel側
```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
PYTHON_API_URL=https://api.example.com
PYTHON_API_KEY=
```

### Python API側
```bash
ANTHROPIC_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
API_KEY=
```

## ディレクトリ構成

### Webアプリ側（Next.js）

```
apps/web/
├── app/
│   ├── (auth)/
│   ├── (app)/
│   │   ├── dashboard/
│   │   ├── properties/
│   │   ├── upload/
│   │   ├── preview/[id]/
│   │   ├── assign/[id]/
│   │   ├── memos/
│   │   └── settings/
│   ├── api/
│   │   ├── pdf/parse/route.ts
│   │   └── excel/export/route.ts
│   └── layout.tsx
├── lib/
│   ├── supabase/
│   ├── python-api/
│   │   ├── client.ts
│   │   └── types.ts
│   ├── excel/
│   └── utils/
├── components/
└── types/
```

### Python API側

```
apps/api/
├── main.py
├── routers/
│   ├── pdf.py
│   └── health.py
├── services/
│   ├── pdf_parser.py
│   ├── classifier.py
│   ├── ai_classifier.py
│   └── corrections.py
├── schemas/
│   └── models.py
├── core/
│   ├── config.py
│   └── auth.py
├── tests/
├── pyproject.toml
└── Dockerfile
```

## 通信プロトコル

Vercel → Python API はHTTP（REST）。簡単な認証として、`X-API-Key` ヘッダーで共有秘密鍵を付与。

```typescript
// lib/python-api/client.ts
async function callPythonApi(path: string, body: unknown) {
  const res = await fetch(`${process.env.PYTHON_API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.PYTHON_API_KEY!,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
```

## マルチテナント設計の原則

将来のSaaS化を見据え、**最初から組み込む**：

1. **organizations テーブル**を必ず作る
2. **すべてのテーブルに `organization_id` を持たせる**
3. **Supabase RLS で完全分離**
4. **users と organizations は多対多**（招待制）
5. ユーザーは組織を切り替えて使う

詳細は [`02-data-model.md`](./02-data-model.md) 参照。

## 認可モデル

| ロール | スコープ | 主な権限 |
|---|---|---|
| `owner` | organization | 課金・組織削除・全権限（将来用） |
| `admin` | organization | ユーザー招待・担当者マスタ・全データ |
| `member` | organization | PDFアップロード・割当・閲覧・出力 |

MVPでは `admin` と `member` の2ロールで動かす。
