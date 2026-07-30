"use client";
import { useState } from "react";

// ============================================================
// 🔍 住所検索バー（2026-07-30 上段の帯に組み込み）
//
// ★位置と高さは、この中では決めていない★
//   AppleMap.tsx の上段の帯（UI_EDGE / UI_ROW_H / UI_GAP）が
//   位置も高さも決める。ここは「残り幅いっぱいに伸びる部品」として
//   振る舞うだけ。
//   ＝ 絞り込みボタン・現在地ボタンと必ず同じ高さ・同じ上端になる。
//
// 【以前との違い】
//   以前はこのファイルが自分で position:absolute / top / width を
//   持っていたため、他のボタンと高さや余白が揃わなかった。
//   その指定を全て捨て、並べる責任を親（AppleMap.tsx）に一本化した。
//
// 【調整したいとき】
//   ・高さ・上端・左右の余白 → AppleMap.tsx の UI_* を変える
//   ・文字サイズ・角の丸み   → 下の FONT_SIZE / 角丸を変える
// ============================================================
const FONT_SIZE = 14;

interface SearchBarProps {
  onSearch: (lat: number, lng: number, boundingBox?: [string, string, string, string]) => void;
  /** 上段の帯の高さ。親から渡される（省略時は36px） */
  height?: number;
}

export default function SearchBar({ onSearch, height = 36 }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query) return;
    setLoading(true);

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=jp`
      );
      const data = await res.json();

      if (data.length > 0) {
        onSearch(parseFloat(data[0].lat), parseFloat(data[0].lon), data[0].boundingbox);
      } else {
        alert("場所が見つかりませんでした");
      }
    } catch {
      // ★元の実装では通信失敗時にloadingが戻らず、以後検索できなくなっていた
      alert("検索に失敗しました。時間をおいてもう一度お試しください。");
    }

    setLoading(false);
  };

  return (
    <div
      style={{
        // 残り幅いっぱいに伸びる。minWidth:0 が無いと、中の入力欄が
        // 縮まずに帯からはみ出すので必ず付けること。
        flex: 1,
        minWidth: 0,
        height,
        display: "flex",
        alignItems: "center",
        background: "white",
        borderRadius: height / 2,
        padding: "0 14px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
        gap: "8px",
        // 検索中はうっすら薄くして、処理中であることを伝える
        opacity: loading ? 0.7 : 1,
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#888"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0 }}
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => e.key === "Enter" && handleSearch()}
        placeholder="住所で検索（例：東京都新宿区）"
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          outline: "none",
          fontSize: `${FONT_SIZE}px`,
          background: "transparent",
          color: "#333",
        }}
      />
    </div>
  );
}
