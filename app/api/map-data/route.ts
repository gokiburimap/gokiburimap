// ============================================================
// /api/map-data
//
// 地図に表示するデータを返す入口。
//
// 【なぜ必要か】
// 従来の地図は、全投稿をブラウザへ配っていた（fetchReports）。
// 投稿が数十万件を超えると、転送量とメモリの両方で破綻する。
// このAPIは「画面に映っている範囲のぶんだけ」を返すため、
// 総件数が何百万件になっても、送る量は画面の広さだけで決まる。
//
// 【2つのモードを自動で切り替える】
// ・ズームが浅いとき（俯瞰）  → tiles：区画ごとの集計だけを返す
//   　DBが区画ごとに数えた結果（件数・nearby_countの最大値・代表座標）を
//   　返すので、投稿が何件あっても数十行で済む。
// ・ズームが深いとき（霧モード）→ reports：個別の投稿を返す
//   　霧を1件ずつ描く必要があるため。画面内だけなので数百件に収まる。
//
// 切り替えの境目は、地図側の霧モードのしきい値（CLOUD_ZOOM_THRESHOLD）と
// 揃える。地図から zoom を受け取り、このAPIが判断する。
//
// 【期間の絞り込み】
// period に 'all' / '1y' / '3m' を渡すと、その期間で数えた値を返す。
// 集計はDB側に事前計算してあるため、絞り込んでも処理は増えない。
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/app/lib/supabase-server";

export const dynamic = "force-dynamic";

// 霧モードに入るズーム。地図側の CLOUD_ZOOM_THRESHOLD と揃えること。
// これ以上に寄ったら個別の投稿を返し、それより浅ければ集計を返す。
const DETAIL_ZOOM = 16;

// 個別投稿を返すときの上限。画面内が極端に混んでいても、
// これ以上は送らない（送っても描き切れず、重くなるだけのため）。
const DETAIL_LIMIT = 5000;

// 集計を持っているズームの範囲（SQL側の rebuild_report_tiles と揃える）
// ★16まで持つ理由：地図が霧モードに入るのがズーム16なので、その手前まで
//   細かい集計が必要。13までしか無いと、ズーム14〜15で粗い集計（4km四方）を
//   狭い画面に出すことになり、代表座標に実際の投稿が無い場合、そこへ
//   ズームした瞬間に表示が消える不具合が起きる。
const TILE_ZOOM_MIN = 4;
const TILE_ZOOM_MAX = 16;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  // ---- 引数の受け取りと検証 ----
  // ※ sp.get() は未指定のとき null を返し、Number(null) は 0 になる。
  //   数値かどうかだけで判定すると「緯度0・経度0」を指定されたと誤認するため、
  //   まず存在を確かめる（過去に同じ原因の不具合があった）。
  const rawMinLat = sp.get("minLat");
  const rawMinLng = sp.get("minLng");
  const rawMaxLat = sp.get("maxLat");
  const rawMaxLng = sp.get("maxLng");
  const rawZoom = sp.get("zoom");

  if (
    rawMinLat === null ||
    rawMinLng === null ||
    rawMaxLat === null ||
    rawMaxLng === null ||
    rawZoom === null
  ) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  const minLat = Number(rawMinLat);
  const minLng = Number(rawMinLng);
  const maxLat = Number(rawMaxLat);
  const maxLng = Number(rawMaxLng);
  const zoom = Number(rawZoom);

  if (
    !Number.isFinite(minLat) ||
    !Number.isFinite(minLng) ||
    !Number.isFinite(maxLat) ||
    !Number.isFinite(maxLng) ||
    !Number.isFinite(zoom)
  ) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  // 期間の絞り込み。想定外の値は全期間として扱う。
  const rawPeriod = sp.get("period");
  const period =
    rawPeriod === "1y" || rawPeriod === "3m" ? rawPeriod : "all";

  const supabase = getServiceClient();

  // ============================================================
  // ズームが深い（霧モード）→ 個別の投稿を返す
  // ============================================================
  if (zoom >= DETAIL_ZOOM) {
    const { data, error } = await supabase.rpc("reports_in_bounds", {
      p_min_lat: minLat,
      p_min_lng: minLng,
      p_max_lat: maxLat,
      p_max_lng: maxLng,
      p_period: period,
      p_limit: DETAIL_LIMIT,
    });

    if (error) {
      console.error("投稿の範囲取得に失敗:", error);
      return NextResponse.json(
        { mode: "reports", reports: [], error: error.message },
        { status: 200 }
      );
    }

    return NextResponse.json({
      mode: "reports",
      period,
      reports: data ?? [],
      // 上限に達した場合、画面内に表示しきれていない投稿がある
      truncated: (data?.length ?? 0) >= DETAIL_LIMIT,
    });
  }

  // ============================================================
  // ズームが浅い（俯瞰）→ 区画ごとの集計を返す
  // ============================================================
  // 地図のズームは小数になることがあるため、整数に丸めて
  // 集計を持っている範囲（4〜13）に収める。
  const tileZoom = Math.min(
    TILE_ZOOM_MAX,
    Math.max(TILE_ZOOM_MIN, Math.round(zoom))
  );

  const { data, error } = await supabase.rpc("tiles_in_bounds", {
    p_zoom: tileZoom,
    p_min_lat: minLat,
    p_min_lng: minLng,
    p_max_lat: maxLat,
    p_max_lng: maxLng,
    p_period: period,
  });

  if (error) {
    console.error("タイル集計の取得に失敗:", error);
    return NextResponse.json(
      { mode: "tiles", tiles: [], error: error.message },
      { status: 200 }
    );
  }

  return NextResponse.json({
    mode: "tiles",
    period,
    zoom: tileZoom,
    tiles: data ?? [],
  });
}