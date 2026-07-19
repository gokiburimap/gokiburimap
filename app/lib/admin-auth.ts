// app/lib/admin-auth.ts
//
// ============================================================
// 管理API用の合言葉チェック（2026-07-19 新設）
//
// 管理画面(/admin)からのリクエストは、すべて x-admin-key ヘッダーに
// 合言葉(ADMIN_SECRET)を載せて送られてくる。ここで照合し、
// 一致しないリクエストは管理APIの入口で全部弾く。
//
// ・ADMIN_SECRET は .env.local に設定する（30文字以上のランダム文字列）
// ・本番デプロイ時は、Vercelの環境変数にも登録を忘れないこと
// ・将来Googleログイン等を導入したら、この方式からSupabase Authの
//   ロール判定に置き換える余地がある（当面は運営1人なのでこれで十分）
// ============================================================

import { NextRequest } from "next/server";

export function isAdmin(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  // 環境変数が未設定なら、誰も管理者になれない（安全側に倒す）
  if (!secret || secret.length < 10) return false;
  return req.headers.get("x-admin-key") === secret;
}