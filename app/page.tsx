"use client";

import { useEffect, useRef, useState } from "react";
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

// ============================================================
// 🪳 投稿直後の確認ピン用の型（2026-07-18 追加）
//
// AppleMap.tsx / ReportSidebar.tsx にも同じ型がある。
// DBの項目を変えるときは、3ファイルすべてを揃えること。
//
// ★detail だけは特別★
//   DBの reports テーブルには存在しない。投稿直後に本人へ内容を
//   見せるためだけに、メモリ上で持ち回す値。
// ============================================================
interface Report {
  id: number;
  lat: number;
  lng: number;
  address?: string;
  occurred_on?: string; // "2026-07-18" 形式
  detail?: string;
  delete_token?: string; // ★確認ピンの取り消しボタン用。メモリ上だけの値
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
  // ============================================================
  // 🚫 投稿できない場所をタップしたときの警告（2026-07-18 追加）
  // ズーム警告(showZoomWarning)と同じ仕組み。海外・海などをタップすると
  // trueになり、画面のどこかを押すと消える。
  // ============================================================
  const [showOutOfServiceWarning, setShowOutOfServiceWarning] = useState(false);

  // ============================================================
  // 🔑 管理者モード（2026-07-19 追加）
  // URLに ?admin を付けてアクセスし、かつ管理画面(/admin)でログイン済み
  // （localStorageに合言葉がある）の場合だけ、地図に投稿ピンが出る。
  // 合言葉はサーバー側で検証されるので、?adminを付けただけの一般人には
  // 何も表示されない（ピン用のデータが1件も返らない）。
  // ============================================================
  const [adminKey, setAdminKey] = useState<string | null>(null);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("admin")) {
      const key = localStorage.getItem("adminKey");
      if (key) setAdminKey(key);
    }
  }, []);

  // ============================================================
  // 🪳 投稿直後の確認ピン（2026-07-18 追加）
  //
  // 投稿が成功したときだけ、ここに投稿内容が入る。
  // 地図側(AppleMap.tsx)はこの値を見て、その場にゴキブリを立てて
  // 吹き出しで内容を表示する。
  //
  // ★これはReactのstate（ブラウザのメモリ）に一時的に置いているだけ★
  //   ・ページを更新する、サイトから離脱する → 自動的に消える
  //   ・その後は通常通り霧だけが残る
  //   ・DBには一切保存しないので、他人には絶対に見えない
  // ============================================================
  const [justPosted, setJustPosted] = useState<Report | null>(null);

  const handleStartReport = () => {
    if (mapRef.current && !mapRef.current.isZoomedInEnough()) {

      setShowZoomWarning(true);
      return;
    }
    // 新しく報告を始めるときは、前回の確認ピンを片付けておく
    setJustPosted(null);
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

  // ============================================================
  // 投稿完了時の処理（2026-07-18 変更）
  //
  // ★ReportSidebar側から、投稿した内容(report)を受け取れるようにした。
  //   受け取れた場合だけ、その場に確認ピンを立てる。
  //   受け取れなかった場合(report===undefined)は、従来通り何も立てずに
  //   霧だけが増える。＝ ReportSidebarを直す前でもエラーにはならない。
  //
  //   ReportSidebar.tsx 側で必要な変更は「onSubmitDone() を
  //   onSubmitDone(投稿したデータ) に変える」だけ。詳細は納品メモを参照。
  // ============================================================
  const handleSubmitDone = (report?: Report) => {
    setStep("idle");
    setPos(null);
    setGeoData(null);
    setJustPosted(report ?? null);
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
          justPosted={justPosted}
          onDismissJustPosted={() => setJustPosted(null)}
          onJustPostedDeleted={() => {
            // 取り消し成功：確認ピンを消し、地図を再読込して霧も消す
            // （DB側はトリガーが周辺のnearby_countを自動で減らしている）
            setJustPosted(null);
            setRefreshTrigger(n => n + 1);
          }}
          onOutOfService={() => setShowOutOfServiceWarning(true)}
          adminKey={adminKey}
        />

        {/* 🔑 管理者モードのバッジ（押すと管理画面に戻れる） */}
        {adminKey && (
          <a
            href="/admin"
            style={{
              position: "absolute",
              top: 70,
              left: "50%",
              transform: "translateX(-50%)",
              background: "#662510",
              color: "#fff",
              padding: "6px 16px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 600,
              zIndex: 1000,
              boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            管理者モード：ズームすると📍が出ます（ここを押すと管理画面へ）
          </a>
        )}
        
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

        {/* ============================================================
            🚫 投稿できない場所の警告（2026-07-18 追加）
            ズーム警告と全く同じ作り。画面のどこかを押すと消える。
            ★文言を変えたいときは、下の「この場所には投稿できません」を直す★
           ============================================================ */}
        {showOutOfServiceWarning && (
          <div
            onClick={() => setShowOutOfServiceWarning(false)}
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
              この場所には投稿できません
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
