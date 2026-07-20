// app/api/admin/excluded-areas/route.ts
//
// ============================================================
// 投稿禁止エリアの管理API（2026-07-19 新設）
//
// GET    ：登録済みエリアの一覧
// POST   ：エリアの追加（2方式）
//   方式A：geojson.ioで描いたGeoJSONを貼り付け（皇居・古墳など大物用）
//   方式B：地点＋半径mの円形エリア（イタズラ投稿への即応用）
// DELETE ：エリアの削除（body: { id }）
//
// すべて x-admin-key ヘッダーの合言葉が必要。
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "../../../lib/supabase-server";
import { isAdmin } from "../../../lib/admin-auth";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from("excluded_areas")
    .select("id, name, reason, cover, created_at")
    .order("id", { ascending: false });

  if (error) {
    console.error("禁止エリア一覧の取得に失敗:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  return NextResponse.json({ areas: data });
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

  const { name, reason } = body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }
  // フタもするか（未指定はfalse＝投稿禁止だけ）
  const cover = body.cover === true;

  const supabase = getServiceClient();

  // ------------------------------------------------------------
  // 方式B：地点＋半径の円形エリア（lat/lng/radius_mが揃っている場合）
  // ------------------------------------------------------------
  if (
    typeof body.lat === "number" &&
    typeof body.lng === "number" &&
    typeof body.radius_m === "number"
  ) {
    if (body.radius_m < 5 || body.radius_m > 5000) {
      return NextResponse.json({ error: "radius_out_of_range" }, { status: 400 });
    }
    const { error } = await supabase.rpc("add_excluded_circle", {
      p_name: name.trim(),
      p_reason: reason ?? null,
      p_lat: body.lat,
      p_lng: body.lng,
      p_radius_m: body.radius_m,
      p_cover: cover,
    });
    if (error) {
      console.error("円形エリアの登録に失敗:", error);
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // ------------------------------------------------------------
  // 方式A：GeoJSONの貼り付け
  // geojson.ioのエクスポートはFeatureCollection形式。中のFeatureを
  // 1つずつ取り出して登録する（複数ポリゴンを一度に描いてもOK）。
  // 単体のFeature・生のGeometryが貼られても動くようにしてある。
  // ------------------------------------------------------------
  if (body.geojson) {
    let gj: any = body.geojson;
    if (typeof gj === "string") {
      try {
        gj = JSON.parse(gj);
      } catch {
        return NextResponse.json({ error: "invalid_geojson" }, { status: 400 });
      }
    }

    // FeatureCollection / Feature / Geometry のどれでも、Geometryの配列に揃える
    let geometries: any[] = [];
    if (gj.type === "FeatureCollection" && Array.isArray(gj.features)) {
      geometries = gj.features.map((f: any) => f?.geometry).filter(Boolean);
    } else if (gj.type === "Feature" && gj.geometry) {
      geometries = [gj.geometry];
    } else if (gj.type) {
      geometries = [gj];
    }

    if (geometries.length === 0) {
      return NextResponse.json({ error: "no_geometry" }, { status: 400 });
    }

    for (let i = 0; i < geometries.length; i++) {
      const suffix = geometries.length > 1 ? `（${i + 1}/${geometries.length}）` : "";
      const { error } = await supabase.rpc("add_excluded_geojson", {
        p_name: name.trim() + suffix,
        p_reason: reason ?? null,
        p_geojson: geometries[i],
        p_cover: cover,
      });
      if (error) {
        console.error("GeoJSONエリアの登録に失敗:", error);
        return NextResponse.json(
          { error: "internal_error", detail: `${i + 1}個目の図形で失敗` },
          { status: 500 }
        );
      }
    }
    return NextResponse.json({ ok: true, count: geometries.length });
  }

  return NextResponse.json({ error: "geojson_or_circle_required" }, { status: 400 });
}

// ============================================================
// PUT：指定エリア内の既存投稿を全削除（クレーム対応用・2026-07-19追加）
//
// 禁止エリアの登録は「新規投稿を止める」だけで、エリア内にすでにある
// 投稿（＝立っている霧）は消えない。管理会社・オーナーからの
// 「うちの建物に霧がかかっている」クレームには、
//   ①建物ポリゴンを登録 → ②このPUTで中の投稿を一掃
// のセットで対応する。削除トリガーが1件ずつ動くので、
// 周辺の霧の色(nearby_count)も自動で正しく減る。
// body: { purge_area_id: エリアのid }
// ============================================================
export async function PUT(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const areaId = Number(body?.purge_area_id);
  if (!Number.isInteger(areaId) || areaId <= 0) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { data: deletedCount, error } = await supabase.rpc(
    "delete_reports_in_excluded_area",
    { p_area_id: areaId }
  );
  if (error) {
    console.error("エリア内投稿の一括削除に失敗:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, deleted: deletedCount ?? 0 });
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
  const { error } = await supabase.from("excluded_areas").delete().eq("id", id);
  if (error) {
    console.error("禁止エリアの削除に失敗:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}