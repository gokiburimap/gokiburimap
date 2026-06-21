"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function ReportForm({ onClose }: { onClose: () => void }) {
  const [buildingName, setBuildingName] = useState("");
  const [address, setAddress] = useState("");
  const [position, setPosition] = useState("室内");
  const [periodYear, setPeriodYear] = useState(2024);
  const [periodMonth, setPeriodMonth] = useState(1);
  const [species, setSpecies] = useState("不明");
  const [situation, setSituation] = useState("1匹");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!buildingName || !address) {
      alert("建物名と住所を入力してください");
      return;
    }

    setLoading(true);

    // 住所から緯度経度を取得（Nominatim）
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`
    );
    const geoData = await geoRes.json();

    if (!geoData.length) {
      alert("住所が見つかりませんでした");
      setLoading(false);
      return;
    }

    const lat = parseFloat(geoData[0].lat);
    const lng = parseFloat(geoData[0].lon);

    const { error } = await supabase.from("reports").insert({
      building_name: buildingName,
      address,
      lat,
      lng,
      position,
      period_year: periodYear,
      period_month: periodMonth,
      species,
      situation,
    });

    if (error) {
      alert("投稿に失敗しました"+ error.message);
    } else {
      alert("投稿しました！");
      onClose();
    }

    setLoading(false);
  };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
      background: "rgba(0,0,0,0.5)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center"
    }}>
      <div style={{
        background: "white", padding: "24px", borderRadius: "12px",
        width: "90%", maxWidth: "400px"
      }}>
        <h2 style={{ marginBottom: "16px" }}>🪳 ゴキブリを報告する</h2>

        <label>建物名</label>
        <input value={buildingName} onChange={e => setBuildingName(e.target.value)}
          placeholder="○○マンション" style={{ width: "100%", marginBottom: "12px", padding: "8px" }} />

        <label>住所</label>
        <input value={address} onChange={e => setAddress(e.target.value)}
          placeholder="東京都新宿区○○1-2-3" style={{ width: "100%", marginBottom: "12px", padding: "8px" }} />

        <label>発生場所</label>
        <select value={position} onChange={e => setPosition(e.target.value)}
          style={{ width: "100%", marginBottom: "12px", padding: "8px" }}>
          <option>室内</option>
          <option>共用部（廊下・エントランス等）</option>
          <option>駐車場・外周</option>
        </select>

        <label>発生時期</label>
        <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
          <input type="number" value={periodYear} onChange={e => setPeriodYear(Number(e.target.value))}
            style={{ width: "50%", padding: "8px" }} placeholder="年" />
          <input type="number" value={periodMonth} onChange={e => setPeriodMonth(Number(e.target.value))}
            min={1} max={12} style={{ width: "50%", padding: "8px" }} placeholder="月" />
        </div>

        <label>種類</label>
        <select value={species} onChange={e => setSpecies(e.target.value)}
          style={{ width: "100%", marginBottom: "12px", padding: "8px" }}>
          <option>不明</option>
          <option>黒ゴキブリ</option>
          <option>チャバネゴキブリ</option>
        </select>

        <label>状況</label>
        <select value={situation} onChange={e => setSituation(e.target.value)}
          style={{ width: "100%", marginBottom: "16px", padding: "8px" }}>
          <option>1匹</option>
          <option>複数</option>
          <option>卵も発見</option>
        </select>

        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={handleSubmit} disabled={loading}
            style={{ flex: 1, background: "#ef4444", color: "white", padding: "12px", borderRadius: "8px", border: "none" }}>
            {loading ? "送信中..." : "投稿する"}
          </button>
          <button onClick={onClose}
            style={{ flex: 1, background: "#gray", padding: "12px", borderRadius: "8px", border: "1px solid #ccc" }}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}