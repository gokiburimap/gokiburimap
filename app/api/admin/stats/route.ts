// ============================================================
// /api/admin/stats
//
// 管理画面の上部に出す「今日の投稿件数」を返すだけのAPI。
// 2026-08-01 新設。
//
// 【なぜ既存の /api/admin/reports を使わないか】
// あちらは投稿の中身（住所・詳細込み）を最新200件返すもので、
// 件数を知りたいだけのために毎回それを取るのは無駄が大きい。
// また、200件で打ち切られるため「今日300件あった」場合に
// 正しい数を出せない。
//
// 【数え方】
// created_at（投稿された日時）で数える。occurred_on（目撃日）ではない。
//   ・「今日どれだけ投稿があったか」を知りたいのが目的のため
//   ・occurred_on だと、今日投稿された過去の目撃が入らず、
//     昨日投稿された今日の目撃が入ってしまう
//
// 【日付の境目】
// 日本時間の0時を境にする。サーバー（Vercel）は通常UTCで動くため、
// そのまま数えると日本時間の朝9時までは前日の集計になってしまう。
//
// 【hidden の扱い】
// 非表示にした投稿も数える。「投稿があった事実」を知るのが目的で、
// 地図に出ているかどうかは別の話のため。
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/app/lib/supabase-server";
import { isAdmin } from "@/app/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * 日本時間の「今日の0時」を、UTCの時刻として返す。
 *
 * 【考え方】
 * 現在時刻に9時間を足すと、その値をUTCとして読んだときの日付が
 * 日本時間の日付になる。そこから時分秒を切り捨てて0時にし、
 * 最後に9時間を引いて実際のUTCへ戻す。
 * （app/lib/dateRange.ts と同じ考え方）
 */
function jstStartOfToday(): Date {
  const NINE_HOURS = 9 * 60 * 60 * 1000;
  const shifted = new Date(Date.now() + NINE_HOURS);
  const jstMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate()
  );
  return new Date(jstMidnight - NINE_HOURS);
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();
  const since = jstStartOfToday().toISOString();

  // head:true ＋ count:"exact" で、行そのものは取らずに件数だけ数える。
  // 何件あっても転送量は変わらない。
  const { count, error } = await supabase
    .from("reports")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);

  if (error) {
    console.error("件数の取得に失敗:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  return NextResponse.json({
    today: count ?? 0,
    // 画面に「いつからの集計か」を出すために返す（日本時間の0時）
    since,
  });
}