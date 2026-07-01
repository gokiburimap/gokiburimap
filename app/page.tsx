"use client";

import { useState } from "react";
import Map from "./components/Map";
import ReportSidebar from "./components/ReportSidebar";

type Step = "idle" | "selecting" | "dragging" | "inputting";

interface ReportPos {
  lat: number;
  lng: number;
}

export default function Home() {
  const [step, setStep] = useState<Step>("idle");
  const [pos, setPos] = useState<ReportPos | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleStartReport = () => setStep("selecting");

  const handleMapClick = (lat: number, lng: number) => {
    if (step !== "selecting") return;
    setPos({ lat, lng });
    setStep("dragging");
  };

  const handleStartInput = (lat: number, lng: number) => {
    setPos({ lat, lng });
    setStep("inputting");
  };

  const handleCancel = () => {
    setStep("idle");
    setPos(null);
  };

  const handleSubmitDone = () => {
    setStep("idle");
    setPos(null);
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
          onMapClick={handleMapClick}
          reportPos={pos}
          isSelecting={step === "selecting"}
          onStartInput={handleStartInput}
          onCancel={handleCancel}
          refreshTrigger={refreshTrigger}
        />

        {step === "selecting" && (
          <div style={{
            position: "absolute",
            top: "70px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.75)",
            color: "white",
            padding: "10px 20px",
            borderRadius: "24px",
            fontSize: "14px",
            zIndex: 1000,
            pointerEvents: "none",
          }}>
            📍 建物をタップしてください
          </div>
        )}

        {step === "idle" && (
          <button
            onClick={handleStartReport}
            style={{
              position: "absolute",
              bottom: "80px",
              right: "32px",
              background: "#ef4444",
              color: "white",
              padding: "16px 24px",
              borderRadius: "50px",
              border: "none",
              fontSize: "16px",
              fontWeight: "bold",
              cursor: "pointer",
              zIndex: 500,
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            🪳 報告する
          </button>
        )}

        {step === "inputting" && pos && (
          <ReportSidebar
            lat={pos.lat}
            lng={pos.lng}
            onClose={handleCancel}
            onSubmitDone={handleSubmitDone}
          />
        )}
      </div>
    </main>
  );
}