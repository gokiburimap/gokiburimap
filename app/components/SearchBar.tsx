"use client";
import { Search } from "lucide-react";
import { useState } from "react";

interface SearchBarProps {
  onSearch: (lat: number, lng: number) => void;
}

export default function SearchBar({ onSearch }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query) return;
    setLoading(true);

    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=jp`
    );
    const data = await res.json();

    if (data.length > 0) {
      onSearch(parseFloat(data[0].lat), parseFloat(data[0].lon));
    } else {
      alert("場所が見つかりませんでした");
    }

    setLoading(false);
  };

  return (
    <div style={{
  position: "absolute",
  top: "12px",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  width: "70%",
  maxWidth: "360px",
  background: "white",
  borderRadius: "24px",
  padding: "8px 14px",
  boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
  gap: "8px",
}}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
  <circle cx="11" cy="11" r="7"/>
  <path d="M21 21l-4.35-4.35"/>
</svg>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => e.key === "Enter" && handleSearch()}
        placeholder="住所で検索（例：東京都新宿区）"
        style={{
          flex: 1,
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