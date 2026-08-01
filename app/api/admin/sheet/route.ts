// ============================================================
// /api/admin/sheet
//
// スプレッドシート（Google Apps Script）へ投稿を渡すためのAPI。
// 用途は「記録台帳」への追記のみ。
//
// 【2026-08-01 変更】
// 以前はシート上で非表示・確認済みの切り替えや削除ができたが、
// その機能は廃止した（POST / DELETE を削除）。理由は次の3つ。
//   ・投稿の確認・非表示・削除は、地図上の管理者モードで行うほうが
//     位置が見えるぶん判断しやすく、投稿禁止エリアの設定とも地続き
//   ・シートの「削除」列にチェックを入れて実行すると物理削除になり、
//     取り消せない。誤操作の経路そのものを無くした
//   ・シートの役割を「追記のみの記録台帳」に一本化することで、
//     DBで投稿を削除しても記録が残る、という目的が達成できる
//
// ・GET のみ：投稿を古い順に返す。
//     ?after=12345 … このid より大きい投稿だけを返す（追記に使う）
//     ?limit=5000  … 一度に返す件数（既定1000／上限5000）
//
// 【認証】管理APIと同じ合言葉（x-admin-key ヘッダー）。
//        GAS側では、スクリプトプロパティに合言葉を入れて送ること。
//        ※このキーが漏れるとDBを読まれるため、シートとGASプロジェクトは
//          絶対に他人と共有しないこと。
//
// 【返す項目】
//   id / created_at / occurred_on / address / detail / lat / lng
//   ★nearby_count は返さない。その時点の集計値であり、時間が経てば
//     変わるため、記録として残す意味がないため。
//   ★hidden / checked も返さない。台帳は「投稿された事実」の記録であり、
//     その後の運用状態は記録の対象ではないため。
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

  // ★この id より大きいものだけを返す。
  //   シート側は「今シートにある最大のid」を渡してくるので、
  //   まだ取り込んでいない投稿だけが返る。
  //   0（または未指定）なら最初から。
  const afterRaw = Number(sp.get("after"));
  const after = Number.isInteger(afterRaw) && afterRaw > 0 ? afterRaw : 0;

  const supabase = getServiceClient();

  // ★昇順（古い順）で返す。
  //   降順だと、上限に引っかかったときに「新しいほうだけ取れて、
  //   途中が抜ける」という穴ができる。昇順なら、取れたところまでが
  //   必ず連続する。次回はその続きから取れる。
  const { data, error } = await supabase
    .from("reports")
    .select(
      "id, created_at, occurred_on, lat, lng, report_details(address, detail)"
    )
    .gt("id", after)
    .order("id", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("シート用の投稿取得に失敗:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  // シートに貼りやすいよう、住所・詳細を平らにして返す
  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    created_at: r.created_at,
    occurred_on: r.occurred_on,
    address: r.report_details?.address ?? "",
    detail: r.report_details?.detail ?? "",
    lat: r.lat,
    lng: r.lng,
  }));

  // hasMore：まだ続きがあるかどうか。
  // 上限ぴったりの件数が返ったときは、続きがある可能性が高い。
  // GAS側はこれを見て、続きを取りに来る。
  return NextResponse.json({
    rows,
    count: rows.length,
    hasMore: rows.length >= limit,
  });
}