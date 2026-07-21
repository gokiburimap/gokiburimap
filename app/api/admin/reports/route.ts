// app/api/admin/reports/route.ts
//
// ============================================================
// 投稿の管理チェックAPI（2026-07-19 新設）
//
// GET    ：投稿一覧（運営箱の住所・詳細も結合して返す。最新200件）
//          ?unchecked=1 を付けると未チェックのみ
// PATCH  ：チェック済みフラグの更新（body: { id, checked }）
// DELETE ：投稿の削除（body: { id }）
//          削除依頼への対応・イタズラ削除用。cascadeで住所・詳細も消え、
//          DBトリガーが周辺のnearby_count（霧の色）を自動で減らす。
//          posting_logs（開示請求対策の記録）は意図的に残る。
//
// すべて x-admin-key ヘッダーの合言葉が必要。
// ★report_details（誰も読めない運営箱）の中身をブラウザに返すのは
//   このAPIだけ。合言葉が漏れたら中身も漏れる。ADMIN_SECRETの管理は厳重に。
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "../../../lib/supabase-server";
import { isAdmin } from "../../../lib/admin-auth";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const supabase = getServiceClient();
  const sp = req.nextUrl.searchParams;

  // ------------------------------------------------------------
  // ★2026-07-19追加：bboxモード（地図の管理者モード＝投稿ピン表示用）
  // latMin等の4パラメータが揃っていれば、その矩形範囲内の投稿を返す。
  // 最大500件（範囲を狭めれば＝ズームすれば全部見える）。
  // 個別の座標＋運営箱の中身を返す唯一の入口なので、isAdmin必須のまま。
  // ------------------------------------------------------------
  const latMin = sp.get("latMin");
  if (latMin !== null) {
    const nLatMin = Number(latMin);
    const nLatMax = Number(sp.get("latMax"));
    const nLngMin = Number(sp.get("lngMin"));
    const nLngMax = Number(sp.get("lngMax"));
    if ([nLatMin, nLatMax, nLngMin, nLngMax].some((v) => !isFinite(v))) {
      return NextResponse.json({ error: "invalid_bbox" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("reports")
      .select(
        "id, created_at, occurred_on, lat, lng, nearby_count, checked, hidden, report_details(address, detail)"
      )
      .gte("lat", nLatMin)
      .lte("lat", nLatMax)
      .gte("lng", nLngMin)
      .lte("lng", nLngMax)
      .order("id", { ascending: false })
      .limit(500);
    if (error) {
      console.error("bbox投稿一覧の取得に失敗:", error);
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
    return NextResponse.json({ reports: data });
  }

  const uncheckedOnly = sp.get("unchecked") === "1";

  // reportsとreport_detailsを外部キー経由で結合して取得
  let query = supabase
    .from("reports")
    .select(
      "id, created_at, occurred_on, lat, lng, nearby_count, checked, report_details(address, detail)"
    )
    .order("id", { ascending: false })
    .limit(200);

  if (uncheckedOnly) {
    query = query.eq("checked", false);
  }

  const { data, error } = await query;
  if (error) {
    console.error("投稿一覧の取得に失敗:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  return NextResponse.json({ reports: data });
}

export async function PATCH(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  // checked（既読）／hidden（霧だけ消す）のどちらか、または両方を更新
  const patch: { checked?: boolean; hidden?: boolean } = {};
  if (typeof body?.checked === "boolean") patch.checked = body.checked;
  if (typeof body?.hidden === "boolean") patch.hidden = body.hidden;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { error } = await supabase
    .from("reports")
    .update(patch)
    .eq("id", id);
  if (error) {
    console.error("投稿の更新に失敗:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { error } = await supabase.from("reports").delete().eq("id", id);
  if (error) {
    console.error("投稿の削除に失敗:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}