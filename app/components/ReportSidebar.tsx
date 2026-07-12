"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";

interface ReportSidebarProps {
  lat: number;
  lng: number;
  prefecture: string;
  city: string;
  address: string;
  onClose: () => void;
  onSubmitDone: () => void;
}

export default function ReportSidebar({ lat, lng, prefecture, city, address, onClose, onSubmitDone }: ReportSidebarProps) {
  const [prefectureVal, setPrefectureVal] = useState(prefecture);
  const [cityVal, setCityVal] = useState(city);
  const [addressVal, setAddressVal] = useState(address);
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
      address: `${prefectureVal}${cityVal}${addressVal}`,
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

        <label style={labelStyle}>建物名</label>
        <input
          value={buildingName}
          onChange={e => setBuildingName(e.target.value)}
          placeholder="○○マンション"
          style={inputStyle}
        />

        <label style={labelStyle}>発生場所</label>
        <select
          value={position}
          onChange={e => setPosition(e.target.value)}
          style={inputStyle}
        >
          <option>室内</option>
          <option>共用部（廊下・エントランス等）</option>
          <option>駐車場・外周</option>
        </select>

        <label style={labelStyle}>発生時期</label>
        <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
          <input
            type="number"
            value={periodYear}
            onChange={e => setPeriodYear(Number(e.target.value))}
            style={{ flex: 1, padding: "12px", border: "1px solid #ccc", borderRadius: "8px", fontSize: "14px" }}
          />
          <span style={{ lineHeight: "44px" }}>年</span>
          <input
            type="number"
            value={periodMonth}
            onChange={e => setPeriodMonth(Number(e.target.value))}
            min={1}
            max={12}
            style={{ flex: 1, padding: "12px", border: "1px solid #ccc", borderRadius: "8px", fontSize: "14px" }}
          />
          <span style={{ lineHeight: "44px" }}>月</span>
        </div>

        <label style={labelStyle}>種類</label>
        <select
          value={species}
          onChange={e => setSpecies(e.target.value)}
          style={inputStyle}
        >
          <option>不明</option>
          <option>黒ゴキブリ</option>
          <option>チャバネゴキブリ</option>
        </select>

        <label style={labelStyle}>状況</label>
        <select
          value={situation}
          onChange={e => setSituation(e.target.value)}
          style={inputStyle}
        >
          <option>1匹</option>
          <option>複数</option>
          <option>卵も発見</option>
        </select>


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