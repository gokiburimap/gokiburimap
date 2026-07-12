"use client";

import { useRef, useState } from "react";
import Map from "./components/Map";
import ReportSidebar from "./components/ReportSidebar";

type Step = "idle" | "selecting" | "dragging" | "inputting";

interface ReportPos {
  lat: number;
  lng: number;
}

interface GeoData {
  prefecture: string;
  city: string;
  address: string;
}

interface MapHandle {
  isZoomedInEnough: () => boolean;
}

export default function Home() {
  const [step, setStep] = useState<Step>("idle");
  const [pos, setPos] = useState<ReportPos | null>(null);
  const [geoData, setGeoData] = useState<GeoData | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const mapRef = useRef<MapHandle | null>(null);
  const [showZoomWarning, setShowZoomWarning] = useState(false);

  const handleStartReport = () => {
    if (mapRef.current && !mapRef.current.isZoomedInEnough()) {

      setShowZoomWarning(true);
      return;
    }
    setStep("selecting");
  };

  const handleMapClick = (lat: number, lng: number, geo?: GeoData) => {
    if (step === "selecting") {
      setPos({ lat, lng });
      setGeoData(geo ?? null);
      setStep("dragging");
    } else if (step === "dragging") {
      setPos({ lat, lng });
      setGeoData(geo ?? null);
    }
  };

  const handleStartInput = (lat: number, lng: number) => {
    setPos({ lat, lng });
    setStep("inputting");
  };

  const handleCancel = () => {
    setStep("idle");
    setPos(null);
    setGeoData(null);
  };

  const handleSubmitDone = () => {
    setStep("idle");
    setPos(null);
    setGeoData(null);
    setRefreshTrigger(n => n + 1);
  };

  return (
    <main style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{
        background: "white",
        padding: "16px 24px",
        borderBottom: "1px solid #eee",
        flexShrink: 0,
      }}>
        <h1 style={{ margin: 0, fontSize: "20px", fontWeight: "bold", color: "#111" }}>
          ゴキブリマップ
        </h1>
      </header>
      <div style={{ flex: 1, position: "relative" }}>
        <Map
          ref={mapRef}
          onMapClick={handleMapClick}
          reportPos={pos}
          isSelecting={step === "selecting"}
          onStartInput={handleStartInput}
          onCancel={handleCancel}
          refreshTrigger={refreshTrigger}
        />
        
        {showZoomWarning && (
          <div
            onClick={() => setShowZoomWarning(false)}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 2000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
          <div
              style={{
                background: "rgba(255,255,255,0.95)",
                padding: "16px 28px",
                borderRadius: "12px",
                boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
                fontSize: "14px",
                color: "#111",
                textAlign: "center",
                whiteSpace: "nowrap",
              }}
            >
              目撃情報を報告するにはズームインしてください
            </div>
          </div>
        )}
        {step === "selecting" && (
  <div style={{
    position: "absolute",
    bottom: "120px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(255,255,255,0.95)",
    color: "#292524",
    padding: "10px 20px",
    borderRadius: "24px",
    fontSize: "14px",
    fontWeight: 600,
    boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
    zIndex: 1000,
    pointerEvents: "none",
  }}>
    建物をタップしてください
  </div>
)}

        {step === "idle" && (
         <>
  <style>{`
    @keyframes pulse-ring {
      0% { transform: scale(0.95); opacity: 0.3; }
      100% { transform: scale(1.5); opacity: 0; }
    }
  `}</style>

  <div
    style={{
      position: "absolute",
      bottom: "25px",
      right: "25px",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      zIndex: 500,
    }}
  >
    {/* ラベル部分 */}
    <div
      style={{
        background: "#ffffff73",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        borderRadius: "10px",
        padding: "14px 18px",
        boxShadow: "0 2px 14px rgba(0,0,0,0.1)",
        whiteSpace: "nowrap",
      }}
    >
      <div style={{ fontSize: "14px",fontWeight: "500", color: "rgb(51, 54, 57)" }}>
        目撃情報を報告する
      </div>
    </div>

    {/* ボタン部分 */}
    <div style={{ position: "relative", width: "52px", height: "52px" }}>
      {/* 波紋アニメーション */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: "#662510", /* 先ほど選定したゴキブリカラー */
          animation: "pulse-ring 2s ease-out infinite",
        }}
      />
      
      {/* メインボタン */}
      <button
        onClick={handleStartReport}
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: "#662510", /* 先ほど選定したゴキブリカラー */
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          color: "white", /* 文字色を白に */
          fontSize: "24px", /* Gを大きく表示 */
          fontWeight: "600", /* Gを太字に */
          fontFamily: "Arial, sans-serif", /* 視認性の高いゴシック体 */
          lineHeight: 1,
          padding: 0,
        }}
      >
        G
      </button>
    </div>
  </div>
</>
        )}

        {step === "inputting" && pos && (
          <ReportSidebar
            lat={pos.lat}
            lng={pos.lng}
            prefecture={geoData?.prefecture ?? ""}
            city={geoData?.city ?? ""}
            address={geoData?.address ?? ""}
            onClose={handleCancel}
            onSubmitDone={handleSubmitDone}
          />
        )}
      </div>
    </main>
  );
}