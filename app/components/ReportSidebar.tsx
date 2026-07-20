"use client";

import { useState } from "react";
// ★2026-07-18：supabaseの直接importを廃止。投稿は /api/reports 経由に一本化した
// （ブラウザからの直接INSERTはRLSで全面禁止済み）

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
  delete_token?: string; // ★確認ピンの取り消しボタン用。メモリ上だけの値
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
    // 投稿は /api/reports（APIルート）経由に一本化（2026-07-18）
    //
    // サーバー側で以下がまとめて行われる：
    //   ・レート制限（同一IPからの連続投稿チェック）
    //   ・reports（座標・日付）と report_details（住所・詳細）への書き分け
    //   ・投稿者情報（IP/UA/時刻）の記録（発信者情報開示請求への備え）
    //   ・削除トークンの発行（本人だけが取り消せる）
    //
    // ブラウザからSupabaseへの直接INSERTはRLSで全面禁止済みのため、
    // この経路以外で投稿することはできない。
    // ============================================================
    const fullAddress = `${prefectureVal}${cityVal}${addressVal}`;

    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat,
          lng,
          occurred_on: occurredOn,
          address: fullAddress,
          detail: detail.trim(),
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        // ★429 ＝ レート制限。文言を変えたいときはここ
        if (res.status === 429) {
          alert("投稿は一定時間に1件までです。時間をおいてもう一度お試しください。");
        } else if (res.status === 403 && json?.error === "excluded_area") {
          // ★403 ＝ 投稿禁止エリア。文言を変えたいときはここ
          alert("この場所への投稿は受け付けていません。");
        } else {
          alert("投稿に失敗しました: " + (json?.error ?? "不明なエラー"));
        }
        setLoading(false);
        return;
      }

      // ============================================================
      // 投稿直後の確認ピン用に、内容を親(page.tsx)へ渡す
      //
      // ★address・detail はDBから読み直さず、いまフォームが持っている値を
      //   そのまま渡している。だから他人には絶対に見えないし、
      //   ページを更新すれば消える。
      // ★delete_token は確認ピンの「この投稿を取り消す」ボタンで使う。
      //   これもメモリ上だけの値で、ページを離れれば消える。
      // ============================================================
      onSubmitDone({
        ...json.report,
        address: fullAddress,
        detail: detail.trim(),
        delete_token: json.deleteToken,
      });
    } catch {
      alert("通信に失敗しました。時間をおいてもう一度お試しください。");
    }

    setLoading(false);
  };

  // ★2026-07-19 スマホ対応：余白を詰めてフォーム全体をコンパクトに
  // （開いた瞬間に「キャンセル」「投稿する」まで見えるようにする）
  const inputStyle = {
    width: "100%",
    padding: "10px",
    marginBottom: "14px",
    border: "1px solid #ccc",
    borderRadius: "8px",
    fontSize: "14px",
    boxSizing: "border-box" as const,
  };

  // 短くてよい入力欄（都道府県・市区町村・日付）用の幅
  // ★【幅を変えたいときはこの12emを変える】★
  const narrowStyle = {
    ...inputStyle,
    width: "12em",
  };

  const labelStyle = {
    display: "block",
    marginBottom: "6px",
    fontWeight: "bold" as const,
    fontSize: "13px",
  };

  const hintStyle = {
    display: "block",
    marginTop: "-8px",
    marginBottom: "14px",
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
        {/* ★2026-07-19：見出し「🪳 目撃情報を入力」は削除した。
            ボタンを押した直後に開く画面なので自明であり、
            縦のスペースを詰めて「投稿する」まで一目で見せる方を優先 */}

        <label style={labelStyle}>都道府県</label>
        <input
          value={prefectureVal}
          onChange={e => setPrefectureVal(e.target.value)}
          placeholder="東京都"
          style={narrowStyle}
        />

        <label style={labelStyle}>市区町村</label>
        <input
          value={cityVal}
          onChange={e => setCityVal(e.target.value)}
          placeholder="渋谷区"
          style={narrowStyle}
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
          style={narrowStyle}
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
