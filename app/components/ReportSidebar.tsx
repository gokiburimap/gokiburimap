"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";

// ============================================================
// 🪳 投稿直後の確認ピン用の型（2026-07-18 追加）
//
// AppleMap.tsx / page.tsx の Report インターフェースと同じ形。
// DBの項目を変えるときは、3ファイルすべてを揃えること。
//
// ★detail だけは特別★
//   DBの reports テーブルには存在しない。投稿直後に本人へ
//   内容を見せるためだけに、メモリ上で持ち回す値。
//   （実体は report_details テーブル側にある。誰も読み出せない）
// ============================================================
interface Report {
  id: number;
  lat: number;
  lng: number;
  address?: string;
  occurred_on?: string; // "2026-07-18" 形式
  detail?: string;
}

interface ReportSidebarProps {
  lat: number;
  lng: number;
  prefecture: string;
  city: string;
  address: string;
  onClose: () => void;
  onSubmitDone: (report?: Report) => void;
}

// 今日の日付を "YYYY-MM-DD" 形式で返す（<input type="date"> がこの形式を要求する）
function todayString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function ReportSidebar({ lat, lng, prefecture, city, address, onClose, onSubmitDone }: ReportSidebarProps) {
  const [prefectureVal, setPrefectureVal] = useState(prefecture);
  const [cityVal, setCityVal] = useState(city);
  const [addressVal, setAddressVal] = useState(address);

  // ============================================================
  // 📝 収集項目（2026-07-18 全面見直し）
  //
  // 【削除した項目とその理由】
  // ・建物名     → 建物を特定する表示をやめたため不要。訴訟リスクの元になる
  // ・発生場所   → 「室内/共用部/駐車場」は建物への投稿が前提の選択肢。
  //                道路・公園・河川も対象にする方針と合わない
  // ・種類       → 一般の投稿者が黒ゴキブリ/チャバネを見分けるのは困難で、
  //                「不明」ばかりになる。データとしての価値が低い
  // ・状況(匹数) → 数を競う要素になり、イタズラ投稿を誘発する
  //
  // 【残した／新設した項目】
  // ・住所       → 逆ジオコーダの自動入力を、本人が手で直せるようにする
  // ・目撃した日付 → 従来の「発生年/月」を、日付そのものに変更
  // ・詳細       → 自由記述。★reportsではなくreport_detailsテーブルに入る★
  // ============================================================
  const [occurredOn, setOccurredOn] = useState(todayString());
  const [detail, setDetail] = useState("");

  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!occurredOn) {
      alert("目撃した日付を入力してください");
      return;
    }

    setLoading(true);

    // ============================================================
    // ① 公開する箱（reports）に書き込む
    //
    // 地図に霧を描くのに必要なものだけ。住所はここには入れない。
    // ★.select().single() で、書き込んだ行(idを含む)を受け取る。
    //   ②のreport_idと、投稿直後の確認ピンに使う。
    // ============================================================
    const { data, error } = await supabase
      .from("reports")
      .insert({
        lat,
        lng,
        occurred_on: occurredOn,
      })
      .select()
      .single();

    if (error || !data) {
      alert("投稿に失敗しました: " + (error?.message ?? "不明なエラー"));
      setLoading(false);
      return;
    }

    // ============================================================
    // ② 運営だけの箱（report_details）に、住所と自由記述を書き込む
    //
    // ★このテーブルはRLSでSELECTポリシーを作っていないため、
    //   誰も読み出せない（curl・anon key不可）。運営はSupabaseの
    //   管理画面から確認する。
    //
    // ★住所も詳細も、地図表示には使わない。だから公開箱ではなく
    //   こちらに隔離している。
    //
    // ★ここが失敗しても、投稿そのもの(①)は成功扱いにする。
    //   本人には霧が立っているのに「失敗しました」と出るほうが
    //   混乱するため。失敗はコンソールに残すだけにしておく。
    //
    // ※将来 /api/reports (APIルート)を作ったら、①②をまとめてサーバー側で
    //   処理する形に置き換える。IPアドレスの記録・削除トークンの発行も
    //   そのタイミングで一緒に入る。
    // ============================================================
    const fullAddress = `${prefectureVal}${cityVal}${addressVal}`;
    const { error: detailError } = await supabase.from("report_details").insert({
      report_id: data.id,
      address: fullAddress,
      detail: detail.trim() || null,
    });
    if (detailError) {
      console.error("住所・詳細の保存に失敗しました:", detailError);
    }

    // ============================================================
    // ③ 投稿直後の確認ピン用に、内容を親(page.tsx)へ渡す
    //
    // ★address・detail はDBから読み直さず、いまフォームが持っている値を
    //   そのまま渡している。だから他人には絶対に見えないし、
    //   ページを更新すれば消える。
    // ============================================================
    onSubmitDone({
      ...data,
      address: fullAddress,
      detail: detail.trim(),
    });

    setLoading(false);
  };

  const inputStyle = {
    width: "100%",
    padding: "12px",
    marginBottom: "20px",
    border: "1px solid #ccc",
    borderRadius: "8px",
    fontSize: "14px",
    boxSizing: "border-box" as const,
  };

  const labelStyle = {
    display: "block",
    marginBottom: "6px",
    fontWeight: "bold" as const,
    fontSize: "13px",
  };

  const hintStyle = {
    display: "block",
    marginTop: "-14px",
    marginBottom: "20px",
    fontSize: "11px",
    color: "#78716C",
    lineHeight: 1.6,
  };

  return (
    <div style={{
      position: "fixed",
      left: 0,
      top: 0,
      height: "100%",
      width: "100%",
      background: "rgba(0,0,0,0.3)",
      zIndex: 1001,
    }} onClick={onClose}>
      <div style={{
        position: "absolute",
        left: 0,
        top: 0,
        height: "100%",
        width: "90%",
        maxWidth: "400px",
        background: "white",
        padding: "24px",
        overflowY: "auto",
        boxShadow: "2px 0 12px rgba(0,0,0,0.2)",
      }} onClick={e => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, marginBottom: "24px" }}>
          🪳 目撃情報を入力
        </h2>

        <label style={labelStyle}>都道府県</label>
        <input
          value={prefectureVal}
          onChange={e => setPrefectureVal(e.target.value)}
          placeholder="東京都"
          style={inputStyle}
        />

        <label style={labelStyle}>市区町村</label>
        <input
          value={cityVal}
          onChange={e => setCityVal(e.target.value)}
          placeholder="渋谷区"
          style={inputStyle}
        />

        <label style={labelStyle}>住所（丁目・番地）</label>
        <input
          value={addressVal}
          onChange={e => setAddressVal(e.target.value)}
          placeholder="道玄坂1丁目2-3"
          style={inputStyle}
        />
        <span style={hintStyle}>
          自動入力です。違っていたら直してください。
        </span>

        <label style={labelStyle}>目撃した日付</label>
        <input
          type="date"
          value={occurredOn}
          onChange={e => setOccurredOn(e.target.value)}
          max={todayString()}
          style={inputStyle}
        />

        <label style={labelStyle}>詳細（任意）</label>
        <textarea
          value={detail}
          onChange={e => setDetail(e.target.value)}
          placeholder="どんな状況で見かけたか、自由に書いてください"
          rows={5}
          style={{ ...inputStyle, resize: "vertical" as const, fontFamily: "inherit" }}
        />
        <span style={hintStyle}>
          {/*
            ★文言は要検討（本人判断）★
            「地図には出ない」と明示すると、書く意味を感じず未入力が増える可能性がある。
            一方で明示しないと、公開されると思って過激なことを書く人が出る。
            運営しながら調整してください。
          */}
          地図上には表示されません。運営の確認にのみ使用します。
        </span>

        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "14px",
              background: "transparent",
              color: "#662510",
              border: "1.5px solid #662510",
              borderRadius: "8px",
              fontWeight: "bold",
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            キャンセル
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              flex: 1,
              padding: "14px",
              background: "#662510",
              color: "white",
              border: "none",
              borderRadius: "8px",
              fontWeight: "bold",
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            {loading ? "送信中..." : "投稿する"}
          </button>
        </div>

      </div>
    </div>
  );
}
