// app/api/covers/route.ts
//
// ============================================================
// フタ（建物色の板）の取得API（2026-07-19 新設・公開・認証なし）
//
// メイン地図が「今見えている範囲(bbox)」にあるフタの形を取得するのに使う。
// 禁止エリア(excluded_areas)のうち、cover=true のものだけを返す。
//
// ・認証なしで公開してよい理由：フタは地図上で誰にでも見えるものなので、
//   形を隠す意味がそもそもない（運営判断で許容済み）
// ・cover=false の禁止エリア（皇居など「投稿禁止だけ」のもの）の形は
//   このAPIからは一切返らない
// ・Cache-Controlで30秒キャッシュさせ、パン・ズーム連発時の負荷を抑える
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "../../lib/supabase-server";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const latMin = Number(sp.get("latMin"));
  const latMax = Number(sp.get("latMax"));
  const lngMin = Number(sp.get("lngMin"));
  const lngMax = Number(sp.get("lngMax"));

  if ([latMin, latMax, lngMin, lngMax].some((v) => !isFinite(v))) {
    return NextResponse.json({ error: "invalid_bbox" }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("covers_in_bounds", {
    p_lat_min: latMin,
    p_lat_max: latMax,
    p_lng_min: lngMin,
    p_lng_max: lngMax,
  });

  if (error) {
    console.error("フタ取得に失敗:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  return NextResponse.json(
    { covers: data ?? [] },
    { headers: { "Cache-Control": "public, max-age=30" } }
  );
}