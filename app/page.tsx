"use client";

import { useState } from "react";
import Map from "./components/Map";
import ReportForm from "./components/ReportForm";

export default function Home() {
  const [showForm, setShowForm] = useState(false);

  return (
    <main style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <Map />
      <button
        onClick={() => setShowForm(true)}
        style={{
          position: "absolute",
          bottom: "32px",
          right: "32px",
          background: "#ef4444",
          color: "white",
          padding: "16px 24px",
          borderRadius: "50px",
          border: "none",
          fontSize: "16px",
          fontWeight: "bold",
          cursor: "pointer",
          zIndex: 1000,
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        }}
      >
        🪳 報告する
      </button>
      {showForm && <ReportForm onClose={() => setShowForm(false)} />}
    </main>
  );
}