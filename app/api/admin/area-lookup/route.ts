// ============================================================
// /api/admin/area-lookup
//
// 管理者モードの地図で「ここは設定済みか」を確認するための入口。
// 地図に図形を描かずに、文字だけで状況を伝えるために使う。
//
// ・?minLat=..&minLng=..&maxLat=..&maxLng=..
//     → いま見えている範囲にある登録エリアの一覧を返す
// ・?lat=..&lng=..
//     → その1点が、禁止／調整エリアの中かを返す
//
// 返すのは「エリアの種類・ID・名前」だけで、投稿データは含まない。
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
  const supabase = getServiceClient();

  // ---- 全エリアの中心座標（管理画面の「地図で見る」用）----
  if (sp.get("centers") === "1") {
    const { data, error } = await supabase.rpc("area_centers");
    if (error) {
      console.error("エリア中心の取得に失敗:", error);
      return NextResponse.json({ centers: [], error: error.message });
    }
    return NextResponse.json({ centers: data ?? [] });
  }

  // ---- 1点の判定（ホバー／タップ確認）----
  const rawLat = sp.get("lat");
  const rawLng = sp.get("lng");
  if (rawLat !== null && rawLng !== null) {
    const lat = Number(rawLat);
    const lng = Number(rawLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: "invalid_params" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("area_at_point", {
      p_lat: lat,
      p_lng: lng,
    });
    if (error) {
      console.error("地点のエリア判定に失敗:", error);
      return NextResponse.json({ hits: [], error: error.message });
    }
    return NextResponse.json({ hits: data ?? [] });
  }

  // ---- 表示範囲の一覧 ----
  const rawMinLat = sp.get("minLat");
  const rawMinLng = sp.get("minLng");
  const rawMaxLat = sp.get("maxLat");
  const rawMaxLng = sp.get("maxLng");
  if (
    rawMinLat === null ||
    rawMinLng === null ||
    rawMaxLat === null ||
    rawMaxLng === null
  ) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }
  const minLat = Number(rawMinLat);
  const minLng = Number(rawMinLng);
  const maxLat = Number(rawMaxLat);
  const maxLng = Number(rawMaxLng);
  if (
    !Number.isFinite(minLat) ||
    !Number.isFinite(minLng) ||
    !Number.isFinite(maxLat) ||
    !Number.isFinite(maxLng)
  ) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc(
    sp.get("shapes") === "1" ? "area_shapes_in_bounds" : "areas_in_bounds",
    {
      p_min_lat: minLat,
      p_min_lng: minLng,
      p_max_lat: maxLat,
      p_max_lng: maxLng,
    }
  );
  if (error) {
    console.error("範囲内のエリア取得に失敗:", error);
    return NextResponse.json({ areas: [], error: error.message });
  }
  return NextResponse.json({ areas: data ?? [] });
}