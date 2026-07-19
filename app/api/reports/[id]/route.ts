// app/api/reports/[id]/route.ts
//
// ============================================================
// 投稿の取り消しAPI（2026-07-18 新設）
//
// 投稿直後の確認ピンにある「この投稿を取り消す」ボタンから呼ばれる。
// 投稿時に発行した削除トークン(report_details.delete_token)と
// 照合し、一致した場合だけ削除する。
//
// ・トークンは誰も読み出せないreport_details側にあるため、
//   第三者が他人の投稿を消すことはできない
// ・reportsの行を消すと、cascadeでreport_detailsも一緒に消え、
//   DBトリガーが周辺のnearby_count（霧の色の元）を自動で減らす。
//   このAPIが特別なことをする必要はない
// ・posting_logsは意図的に消えない(on delete set null)。
//   開示請求は削除済みの投稿について来ることが多いため、記録は残す
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "../../../lib/supabase-server";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Next.js 15以降、動的ルートのparamsはawaitが必要
  const { id } = await params;
  const reportId = Number(id);

  if (!Number.isInteger(reportId) || reportId <= 0) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const token = req.headers.get("x-delete-token");
  if (!token) {
    return NextResponse.json({ error: "token_required" }, { status: 400 });
  }

  const supabase = getServiceClient();

  // トークン照合（report_detailsは運営箱なので、service roleでしか読めない）
  const { data: detail, error: fetchError } = await supabase
    .from("report_details")
    .select("delete_token")
    .eq("report_id", reportId)
    .single();

  if (fetchError || !detail) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!detail.delete_token || detail.delete_token !== token) {
    return NextResponse.json({ error: "invalid_token" }, { status: 403 });
  }

  // 削除（cascadeでdetailsも消え、トリガーが周辺のnearby_countを更新する）
  const { error: deleteError } = await supabase
    .from("reports")
    .delete()
    .eq("id", reportId);

  if (deleteError) {
    console.error("投稿の削除に失敗:", deleteError);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}