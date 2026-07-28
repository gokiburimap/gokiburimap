"use client";
import { useState } from "react";

// ============================================================
// 🔍【住所検索バーの位置・大きさはここ】(2026-07-27 整理)
//
// PCとスマホで別々に指定できるようにしてある。
// 数値を書き換えるだけで、位置と幅が変わる。
//
// ・top      … 地図の上端からの距離(px)。小さくすると上に寄る
// ・width    … 画面幅に対する割合。小さくすると細くなる
// ・maxWidth … 広い画面での上限幅(px)。PCでの見た目はこれで決まる
//
// ★スマホは、右上の現在地ボタンと重ならない幅にしておくこと。
//   画面幅390pxの端末で、66%＝約257px。左右に約66pxずつ余るので、
//   40pxのボタンが右端に入っても当たらない。
// ============================================================
const SEARCH_PC = { top: 12, width: "70%", maxWidth: 360 };
const SEARCH_SP = { top: 8, width: "66%", maxWidth: 320 };

interface SearchBarProps {
  onSearch: (lat: number, lng: number, boundingBox?: [string, string, string, string]) => void;
}

export default function SearchBar({ onSearch }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  // 画面幅768px未満をスマホ扱い（AppleMap.tsx の isMobile と同じ基準）
  const [isMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );
  const layout = isMobile ? SEARCH_SP : SEARCH_PC;

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
        position: "absolute",
        top: `${layout.top}px`,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        width: layout.width,
        maxWidth: `${layout.maxWidth}px`,
        background: "white",
        borderRadius: "24px",
        padding: "8px 14px",
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
          fontSize: "14px",
          background: "transparent",
          color: "#333",
        }}
      />
    </div>
  );
}