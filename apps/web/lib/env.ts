/**
 * 環境変数の検証 (HIGH H1)
 *
 * サーバ起動時に必要な env が揃っているかを Zod で検証し、欠落していれば
 * 早期に明示的にエラーで落とす。`process.env.X!` の non-null assertion を
 * 排除し、ビルド/起動時に検出できるようにする。
 *
 * NEXT_PUBLIC_* はクライアントバンドルへの inline が必要なので、コード側で
 * 直接 process.env を参照しているが、サーバ側でこのモジュールを import
 * した時点で同時に検証される (boot-time validation)。
 */
import { z } from "zod";

const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  PYTHON_API_URL: z.string().url(),
  PYTHON_API_KEY: z.string().min(8),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  SITE_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * 検証済み env。サーバ側のみで使用すること。
 *
 * クライアントバンドルにこのファイルが含まれた場合、必須環境変数の不足で
 * ビルドが失敗するが、NEXT_PUBLIC_* のみブラウザでも安全に inline される。
 */
export const env: Env = EnvSchema.parse(process.env);
