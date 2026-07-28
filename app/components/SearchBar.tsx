"use client";
import { useState } from "react";

// ============================================================
// 🔍【住所検索バーの位置・大きさはここ】(2026-07-27 整理)
//
// 数値を書き換えるだけで、位置と幅が変わる。
//
// ・SEARCH_TOP_PX   … 地図の上端からの距離(px)。小さくすると上に寄る
// ・SEARCH_WIDTH    … 画面幅に対する割合。小さくすると細くなる
// ・SEARCH_MAX_PX   … 広い画面での上限幅(px)。PCでの見た目はこれで決まる
//
// ★現在地ボタン（右上・MapKit標準）と高さを揃えたい場合★
//   現在地ボタンの位置はMapKit側が決めているため、こちらの
//   SEARCH_TOP_PX を動かして合わせるのが確実。
//   ボタンの大きさは globals.css の .mk-user-location-control で調整する。
// ============================================================
const SEARCH_TOP_PX = 8;
const SEARCH_WIDTH = "66%";
const SEARCH_MAX_PX = 320;

interface SearchBarProps {
  onSearch: (lat: number, lng: number, boundingBox?: [string, string, string, string]) => void;
}

export default function SearchBar({ onSearch }: SearchBarProps) {
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
      alert("検索に失敗しました。時間をおいてもう一度お試しください。");
    }

    setLoading(false);
  };

  return (
    <div
      style={{
        position: "absolute",
        top: `${SEARCH_TOP_PX}px`,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        width: SEARCH_WIDTH,
        maxWidth: `${SEARCH_MAX_PX}px`,
        background: "white",
        borderRadius: "24px",
        padding: "8px 14px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
        gap: "8px",
        // 検索中はうっすら薄くして、押しても反応しないことを伝える
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
          fontSize: "14px",
          background: "transparent",
          color: "#333",
        }}
      />
    </div>
  );
}
