// ============================================================
// /api/admin/fog-areas
//
// 霧調整エリア（fog_adjust_areas）の取得・登録・削除。
//
// ・GET    ：エリア一覧をGeoJSONで返す。地図側が「どの投稿がどのエリアに
//            入るか」をブラウザ内で判定するために使う（投稿ごとにDBへ
//            問い合わせると重いため、エリアの形を丸ごと渡す方式）。
//            エリアは数十個程度なので転送量は小さい。
//            ※このGETだけは管理者以外（一般の地図）も使うため、認証不要。
//              返すのは「エリアの形と調整値」だけで、投稿データは含まない。
// ・POST   ：エリアの登録（描画ツールで作った多角形）。管理者のみ。
// ・DELETE ：エリアの削除。管理者のみ。
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/app/lib/supabase-server";
import { isAdmin } from "@/app/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const supabase = getServiceClient();

  // 表示範囲(bbox)が指定されていれば、その範囲に重なるエリアだけを返す。
  // ★将来エリアが1万件規模になっても耐えるための設計。全件は送らない。
  //   指定が無ければ全件（管理画面の一覧用）。
  const minLat = Number(sp.get("minLat"));
  const minLng = Number(sp.get("minLng"));
  const maxLat = Number(sp.get("maxLat"));
  const maxLng = Number(sp.get("maxLng"));
  const hasBbox =
    Number.isFinite(minLat) &&
    Number.isFinite(minLng) &&
    Number.isFinite(maxLat) &&
    Number.isFinite(maxLng);

  const { data, error } = await supabase.rpc(
    "fog_adjust_areas_geojson",
    hasBbox
      ? { p_min_lat: minLat, p_min_lng: minLng, p_max_lat: maxLat, p_max_lng: maxLng }
      : { p_min_lat: null, p_min_lng: null, p_max_lat: null, p_max_lng: null }
  );
  if (error) {
    console.error("霧調整エリアの取得に失敗:", error);
    return NextResponse.json({ areas: [], error: error.message }, { status: 200 });
  }
  return NextResponse.json({ areas: data ?? [] });
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

  const name = String(body?.name ?? "").trim();
  const note = body?.note ? String(body.note) : null;
  const points = body?.points; // [{lat, lng}, ...] 描画ツールの頂点
  const sizeScale = Number(body?.size_scale ?? 0.75);
  const marginM = Number(body?.margin_m ?? 0);

  if (!name || !Array.isArray(points) || points.length < 3) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }
  if (!(sizeScale > 0 && sizeScale <= 2) || !Number.isFinite(marginM)) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  // 頂点を "lng lat, lng lat, ..." のWKT形式にする（始点で閉じる）
  const coords = points
    .map((p: any) => `${Number(p.lng)} ${Number(p.lat)}`)
    .join(", ");
  const first = `${Number(points[0].lng)} ${Number(points[0].lat)}`;
  const wkt = `POLYGON((${coords}, ${first}))`;

  const supabase = getServiceClient();
  const { error } = await supabase.rpc("add_fog_adjust_area", {
    p_name: name,
    p_note: note,
    p_wkt: wkt,
    p_size_scale: sizeScale,
    p_margin_m: marginM,
  });
  if (error) {
    console.error("霧調整エリアの登録に失敗:", error);
    return NextResponse.json(
      { error: "internal_error", detail: error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
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
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  // 大きさの倍率(size_scale)と余裕(margin_m)を、指定されたものだけ更新する
  const patch: { size_scale?: number; margin_m?: number } = {};
  if (body?.size_scale !== undefined) {
    const v = Number(body.size_scale);
    if (!(v > 0 && v <= 2)) {
      return NextResponse.json({ error: "invalid_params" }, { status: 400 });
    }
    patch.size_scale = v;
  }
  if (body?.margin_m !== undefined) {
    const v = Number(body.margin_m);
    if (!Number.isFinite(v) || v < -500 || v > 500) {
      return NextResponse.json({ error: "invalid_params" }, { status: 400 });
    }
    patch.margin_m = v;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { error } = await supabase.from("fog_adjust_areas").update(patch).eq("id", id);
  if (error) {
    console.error("霧調整エリアの更新に失敗:", error);
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
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { error } = await supabase.from("fog_adjust_areas").delete().eq("id", id);
  if (error) {
    console.error("霧調整エリアの削除に失敗:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}