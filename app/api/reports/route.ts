// app/api/reports/route.ts
//
// ============================================================
// 投稿API（2026-07-18 新設）
//
// 投稿はすべてこのAPIルートを通る（ブラウザからSupabaseへの直接INSERTは
// RLSで全面禁止済み）。「検問所が並んだ関所」の構造にしてあり、
// 上から順に検問を通過した投稿だけがDBに書き込まれる。
//
// 【この1本で担っていること】
//   ・レート制限（同一IPからの連続投稿を制限）
//   ・投稿者情報の記録（IP/UA/時刻 → posting_logs。発信者情報開示請求への備え）
//   ・削除トークンの発行（本人だけが投稿を取り消せる）
//   ・reports（公開箱）と report_details（運営箱）への書き分け
//
// 【将来の検問の予約枠】
//   検問3〜6として、同意チェック・位置情報・ログイン・除外エリアの
//   挿入位置をコメントで確保してある。必要になったらその枠に実装を
//   埋めるだけでよい（テーブル側は alter table add column で列を足す）。
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getServiceClient } from "../../lib/supabase-server";

// ============================================================
// 🚦【①レート制限の調整はここ】
//
// 「同一IPから RATE_LIMIT_WINDOW_MINUTES 分以内に
//   RATE_LIMIT_MAX_POSTS 件まで」投稿できる。
//
// 例：
//   1時間に1件（現在の設定） → MAX_POSTS=1,  WINDOW_MINUTES=60
//   1時間に3件               → MAX_POSTS=3,  WINDOW_MINUTES=60
//   1日に5件                 → MAX_POSTS=5,  WINDOW_MINUTES=1440
//
// ★開発中の注意★
// 自分でテスト投稿すると、この制限に自分が引っかかる。連続テストしたい
// ときは一時的にMAX_POSTSを大きくするか、SQL Editorで
//   delete from posting_logs;
// を実行してログを消せばリセットされる。
// ============================================================
const RATE_LIMIT_MAX_POSTS = 1;
const RATE_LIMIT_WINDOW_MINUTES = 60;

// 入力値の上限（イタズラ・破壊的な巨大データ対策）
const MAX_ADDRESS_LENGTH = 300;
const MAX_DETAIL_LENGTH = 2000;

// ============================================================
// 投稿者のIPアドレスを取り出す。
// Vercel等の環境では、実際の接続元IPは x-forwarded-for ヘッダーの
// 先頭に入っている（カンマ区切りで経由地が並ぶ）。
// ============================================================
function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: NextRequest) {
  // ------------------------------------------------------------
  // リクエストの読み取り
  // ------------------------------------------------------------
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { lat, lng, occurred_on, address, detail } = body ?? {};

  // ------------------------------------------------------------
  // 🛂 検問1：入力チェック
  // ------------------------------------------------------------
  if (typeof lat !== "number" || typeof lng !== "number" || !isFinite(lat) || !isFinite(lng)) {
    return NextResponse.json({ error: "invalid_coordinates" }, { status: 400 });
  }
  if (typeof occurred_on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(occurred_on)) {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }
  // 未来の日付は拒否（タイムゾーン差を考慮して1日だけ余裕を持たせる）
  if (new Date(occurred_on).getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: "future_date" }, { status: 400 });
  }
  if (address != null && (typeof address !== "string" || address.length > MAX_ADDRESS_LENGTH)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }
  if (detail != null && (typeof detail !== "string" || detail.length > MAX_DETAIL_LENGTH)) {
    return NextResponse.json({ error: "invalid_detail" }, { status: 400 });
  }

  const supabase = getServiceClient();
  const ip = getClientIp(req);

  // ------------------------------------------------------------
  // 🛂 検問2：レート制限
  // posting_logsから「このIPの直近WINDOW分の投稿数」を数える。
  // posting_logs_ip_time_idx インデックスが効くので高速。
  // ------------------------------------------------------------
  const windowStart = new Date(
    Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000
  ).toISOString();

  const { count, error: rateError } = await supabase
    .from("posting_logs")
    .select("id", { count: "exact", head: true })
    .eq("ip_address", ip)
    .gte("posted_at", windowStart);

  if (rateError) {
    console.error("レート制限チェックに失敗:", rateError);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  if ((count ?? 0) >= RATE_LIMIT_MAX_POSTS) {
    // 429 = Too Many Requests。フロント側はこのステータスを見て
    // 「時間をおいてください」の案内を出す
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // ------------------------------------------------------------
  // 🛂 検問3：【予約枠・未実装】同意チェック
  // 導入時：bodyに agreed_terms_version を追加し、現行バージョンと
  // 一致しなければ400を返す。reportsに agreed_terms_version 列を追加して保存。
  // ------------------------------------------------------------

  // ------------------------------------------------------------
  // 🛂 検問4：【予約枠・未実装】位置情報の検証（任意・必須にはしない方針）
  // 導入時：bodyに gps_lat/gps_lng（任意）を受け取り、投稿座標との距離を
  // 計算して保存（距離はreports、生座標を持つ場合はreport_details側へ）。
  // 拒否には使わず、信頼度の材料としてのみ使う。
  // ------------------------------------------------------------

  // ------------------------------------------------------------
  // 🛂 検問5：【予約枠・未実装】ログイン確認（Googleログイン導入時）
  // 導入時：Supabase Authのセッションを検証し、user_idをreportsに保存。
  // イタズラが実際に問題化するまで導入しない方針。
  // ------------------------------------------------------------

  // ------------------------------------------------------------
  // 🛂 検問6：投稿禁止エリアチェック（2026-07-19 実装）
  //
  // excluded_areasテーブルに登録されたエリア（皇居・古墳などの
  // GeoJSONポリゴン、またはイタズラ即応の円形エリア）の中への
  // 投稿を拒否する。判定はPostGISのst_intersects（GISTインデックスで高速）。
  //
  // ★判定自体が失敗（DB障害等）した場合は「通す」方針★
  // 安全側＝拒否にすると、障害時にサイト全体の投稿が止まってしまう。
  // 禁止エリアのすり抜けは後から管理画面で消せるが、正常な投稿を
  // 巻き添えで全部止める方が損害が大きい、という判断。
  // ------------------------------------------------------------
  const { data: isExcluded, error: exclError } = await supabase.rpc(
    "is_in_excluded_area",
    { p_lat: lat, p_lng: lng }
  );
  if (exclError) {
    console.error("禁止エリア判定に失敗（投稿は通します）:", exclError);
  } else if (isExcluded === true) {
    // 403 = Forbidden。フロント側はこのステータスを見て案内を出す
    return NextResponse.json({ error: "excluded_area" }, { status: 403 });
  }

  // ------------------------------------------------------------
  // 書き込み①：reports（公開箱）
  // ------------------------------------------------------------
  const { data: report, error: reportError } = await supabase
    .from("reports")
    .insert({ lat, lng, occurred_on })
    .select("id, lat, lng, occurred_on, created_at")
    .single();

  if (reportError || !report) {
    console.error("reports書き込みに失敗:", reportError);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  // ------------------------------------------------------------
  // 書き込み②：report_details（運営箱）＋ 削除トークン発行
  //
  // ★以前(ブラウザ直INSERT時代)は「details失敗でも投稿は成功扱い」
  //   だったが、方針を変更した。削除トークンがdetails側にある以上、
  //   details無しの投稿は「本人が取り消せない投稿」になってしまう。
  //   そのためdetailsの書き込みに失敗したら、reports本体も取り消して
  //   投稿全体を失敗として返す（中途半端な状態を残さない）。
  // ------------------------------------------------------------
  const deleteToken = randomUUID();
  const { error: detailError } = await supabase.from("report_details").insert({
    report_id: report.id,
    address: address || null,
    detail: (detail ?? "").trim() || null,
    delete_token: deleteToken,
  });

  if (detailError) {
    console.error("report_details書き込みに失敗。reportsをロールバックします:", detailError);
    await supabase.from("reports").delete().eq("id", report.id);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  // ------------------------------------------------------------
  // 書き込み③：posting_logs（開示請求対策の記録）
  //
  // ★ここが失敗しても投稿自体は成立させる（本人には関係のない
  //   内部エラーで投稿体験を壊さないため）。ただし失敗はサーバーログに
  //   残し、頻発するようなら調査すること。
  // ------------------------------------------------------------
  const { error: logError } = await supabase.from("posting_logs").insert({
    report_id: report.id,
    ip_address: ip,
    user_agent: req.headers.get("user-agent") ?? null,
  });
  if (logError) {
    console.error("posting_logs書き込みに失敗（投稿自体は成立）:", logError);
  }

  // ------------------------------------------------------------
  // 応答：投稿内容＋削除トークンを本人にだけ返す。
  // トークンはブラウザのメモリ上（確認ピン）でのみ使われ、
  // ページを離れれば消える＝それ以降は誰にも消せない投稿になる。
  // ------------------------------------------------------------
  return NextResponse.json({ report, deleteToken });
}