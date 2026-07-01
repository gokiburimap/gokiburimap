"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";

interface ReportSidebarProps {
  lat: number;
  lng: number;
  onClose: () => void;
  onSubmitDone: () => void;
}

export default function ReportSidebar({ lat, lng, onClose, onSubmitDone }: ReportSidebarProps) {
  const [buildingName, setBuildingName] = useState("");
  const [position, setPosition] = useState("室内");
  const [periodYear, setPeriodYear] = useState(new Date().getFullYear());
  const [periodMonth, setPeriodMonth] = useState(new Date().getMonth() + 1);
  const [species, setSpecies] = useState("不明");
  const [situation, setSituation] = useState("1匹");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!buildingName) {
      alert("建物名を入力してください");
      return;
    }

    setLoading(true);

    const { error } = await supabase.from("reports").insert({
      building_name: buildingName,
      address: "", // 将来的に逆ジオコーディングで埋める
      lat,
      lng,
      position,
      period_year: periodYear,
      period_month: periodMonth,
      species,
      situation,
    });

 if (error) {
      alert("投稿に失敗しました: " + error.message);
    } else {
      onSubmitDone();
    }

    setLoading(false);
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

        <label style={{ display: "block", marginBottom: "12px", fontWeight: "bold" }}>
          建物名
        </label>
        <input
          value={buildingName}
          onChange={e => setBuildingName(e.target.value)}
          placeholder="○○マンション"
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "20px",
            border: "1px solid #ccc",
            borderRadius: "8px",
            fontSize: "14px",
            boxSizing: "border-box",
          }}
        />

        <label style={{ display: "block", marginBottom: "12px", fontWeight: "bold" }}>
          発生場所
        </label>
        <select
          value={position}
          onChange={e => setPosition(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "20px",
            border: "1px solid #ccc",
            borderRadius: "8px",
            fontSize: "14px",
            boxSizing: "border-box",
          }}
        >
          <option>室内</option>
          <option>共用部（廊下・エントランス等）</option>
          <option>駐車場・外周</option>
        </select>

        <label style={{ display: "block", marginBottom: "12px", fontWeight: "bold" }}>
          発生時期
        </label>
        <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
          <input
            type="number"
            value={periodYear}
            onChange={e => setPeriodYear(Number(e.target.value))}
            style={{
              flex: 1,
              padding: "12px",
              border: "1px solid #ccc",
              borderRadius: "8px",
              fontSize: "14px",
            }}
          />
          <input
            type="number"
            value={periodMonth}
            onChange={e => setPeriodMonth(Number(e.target.value))}
            min={1}
            max={12}
            style={{
              flex: 1,
              padding: "12px",
              border: "1px solid #ccc",
              borderRadius: "8px",
              fontSize: "14px",
            }}
          />
        </div>

        <label style={{ display: "block", marginBottom: "12px", fontWeight: "bold" }}>
          種類
        </label>
        <select
          value={species}
          onChange={e => setSpecies(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "20px",
            border: "1px solid #ccc",
            borderRadius: "8px",
            fontSize: "14px",
            boxSizing: "border-box",
          }}
        >
          <option>不明</option>
          <option>黒ゴキブリ</option>
          <option>チャバネゴキブリ</option>
        </select>

        <label style={{ display: "block", marginBottom: "12px", fontWeight: "bold" }}>
          状況
        </label>
        <select
          value={situation}
          onChange={e => setSituation(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "24px",
            border: "1px solid #ccc",
            borderRadius: "8px",
            fontSize: "14px",
            boxSizing: "border-box",
          }}
        >
          <option>1匹</option>
          <option>複数</option>
          <option>卵も発見</option>
        </select>

        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              flex: 1,
              padding: "14px",
              background: "#ef4444",
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
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "14px",
              background: "#f3f4f6",
              color: "#111",
              border: "1px solid #ddd",
              borderRadius: "8px",
              fontWeight: "bold",
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}