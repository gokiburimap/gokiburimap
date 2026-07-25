// ============================================================
// /api/admin/sheet
//
// スプレッドシート（Google Apps Script）から投稿を読み書きするためのAPI。
// 管理画面での目視チェックの代わりに、シート上で確認・整理するための入口。
//
// ・GET    ：投稿を一覧で返す（既定1000件・?limit=／?since=で調整）。
//            シートに取り込みやすいよう、住所・詳細も平らな形で返す。
// ・POST   ：シート側の変更をまとめて反映する（一括更新）。
//            body: { updates: [{ id, hidden?, checked? }, ...] }
//            最大500件まで。
// ・DELETE ：投稿の一括削除。body: { ids: [1,2,3] } 最大500件。
//
// 【認証】管理APIと同じ合言葉（x-admin-key ヘッダー）。
//        GAS側では、スクリプトプロパティに合言葉を入れて送ること。
//        ※このキーが漏れるとDBを操作されるため、シートとGASプロジェクトは
//          絶対に他人と共有しないこと。
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/app/lib/supabase-server";
import { isAdmin } from "@/app/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 1000, 1), 5000);
  const since = sp.get("since"); // 例: 2026-07-01（この日時以降の投稿だけ）

  const supabase = getServiceClient();
  let query = supabase
    .from("reports")
    .select(
      "id, created_at, occurred_on, lat, lng, nearby_count, checked, hidden, report_details(address, detail)"
    )
    .order("id", { ascending: false })
    .limit(limit);

  if (since) {
    query = query.gte("created_at", since);
  }

  const { data, error } = await query;
  if (error) {
    console.error("シート用の投稿取得に失敗:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  // シートに貼りやすいよう、住所・詳細を平らにして返す
  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    created_at: r.created_at,
    occurred_on: r.occurred_on,
    lat: r.lat,
    lng: r.lng,
    nearby_count: r.nearby_count,
    checked: r.checked === true,
    hidden: r.hidden === true,
    address: r.report_details?.address ?? "",
    detail: r.report_details?.detail ?? "",
  }));

  return NextResponse.json({ rows, count: rows.length });
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const updates = body?.updates;
  if (!Array.isArray(updates) || updates.length === 0 || updates.length > 500) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  const supabase = getServiceClient();
  let applied = 0;
  const failed: number[] = [];

  for (const u of updates) {
    const id = Number(u?.id);
    if (!Number.isInteger(id) || id <= 0) continue;

    const patch: { checked?: boolean; hidden?: boolean } = {};
    if (typeof u?.checked === "boolean") patch.checked = u.checked;
    if (typeof u?.hidden === "boolean") patch.hidden = u.hidden;
    if (Object.keys(patch).length === 0) continue;

    const { error } = await supabase.from("reports").update(patch).eq("id", id);
    if (error) {
      failed.push(id);
    } else {
      applied += 1;
    }
  }

  return NextResponse.json({ ok: true, applied, failed });
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

  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }
  const cleanIds = ids
    .map((v: any) => Number(v))
    .filter((v: number) => Number.isInteger(v) && v > 0);
  if (cleanIds.length === 0) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { error } = await supabase.from("reports").delete().in("id", cleanIds);
  if (error) {
    console.error("シートからの一括削除に失敗:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: cleanIds.length });
}