// app/lib/supabase-server.ts
//
// ============================================================
// サーバー専用のSupabaseクライアント（service roleキー使用）
//
// ★★★ 絶対にクライアント側(use client のファイル)からimportしないこと ★★★
// service roleキーはRLSを無視できる全権キー。ブラウザに渡ったら終わり。
// このファイルをimportしてよいのは app/api/ 配下のルートだけ。
//
// キーは .env.local の SUPABASE_SERVICE_ROLE_KEY から読む
// （seed-test-data.mjs用に設定済みのものと同じ。NEXT_PUBLIC_を
//   付けていないので、Next.jsがブラウザ側に埋め込むことはない）。
//
// ★本番デプロイ時の注意★
// Vercelにデプロイする際は、Vercelの管理画面(Settings > Environment
// Variables)にも SUPABASE_SERVICE_ROLE_KEY を登録すること。
// .env.localはGitに上がらないので、登録し忘れると本番だけ投稿が壊れる。
// ============================================================

import { createClient } from "@supabase/supabase-js";

export function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が環境変数にありません"
    );
  }
  return createClient(url, key);
}