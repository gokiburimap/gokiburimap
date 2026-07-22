"use client";

import { useEffect, useRef, useState } from "react";
import Map from "./components/Map";
import ReportSidebar from "./components/ReportSidebar";

type Step = "idle" | "selecting" | "dragging" | "inputting";

// ============================================================
// 🔬 タッチ観測HUD（デバッグ用・2026-07-20）
// ブラウザの生タッチイベントを直接拾い、指の本数・取りこぼしを
// 画面右上に常時表示する。原因が確定したら丸ごと削除する。
//
// document全体で capture フェーズで拾うので、地図やMapKitが
// イベントを消費する前の"生の状態"が見える。これが指を離しても
// 0に戻らなければ、ブラウザ層でタッチが取りこぼされている証拠。
// ============================================================
function TouchDebugHUD() {
  const [info, setInfo] = useState({ raw: 0, max: 0, last: "-" });
  const [dump, setDump] = useState("");
  const [frozen, setFrozen] = useState<string | null>(null);
  const dumpRef = useRef("");

  useEffect(() => {
    let maxSeen = 0;
    let curFingers = 0;

    const buildDump = (): string => {
      try {
        const im = (window as any).__mapForDebug?._impl;
        if (!im) return "(地図なし)";
        const out: string[] = [];

        // ★MapKitが今「握っている」タッチ点の数を探す。
        //   ブラウザの実際の指本数とズレていたら、それが取りこぼしの証拠。
        //   MapKit内部の、タッチ点らしき配列/マップを総当たりで探す。
        let mkTouches = "?";
        try {
          for (const k in im) {
            if (/touch|pointer|finger|_active/i.test(k)) {
              const v = im[k];
              if (Array.isArray(v)) { mkTouches = `${k.slice(-16)}[${v.length}]`; break; }
              if (v && typeof v === "object" && typeof v.size === "number") {
                mkTouches = `${k.slice(-16)}{${v.size}}`; break;
              }
              if (v && typeof v === "object") {
                const n = Object.keys(v).length;
                if (n > 0 && n < 12) { mkTouches = `${k.slice(-16)}:${n}`; break; }
              }
            }
          }
        } catch { /* noop */ }
        out.push(`MK握り=${mkTouches}`);

        const span = (window as any).__mapForDebug?.region?.span?.latitudeDelta;
        if (span != null) out.push(`SPAN=${Number(span).toFixed(5)}`);

        // 🔬 描画回数・マーカー数・キャッシュ枚数（蓄積型固まりの検出用）
        const rs = (window as any).__renderStats;
        if (rs) {
          out.push(`描画回数=${rs.count}`);
          out.push(`マーカー数=${rs.markers}`);
          out.push(`霧cache=${rs.cloudCache} 円cache=${rs.clusterCache}`);
          out.push(`エラー=${rs.errors || 0} ${rs.lastError || ""}`);
        }

        for (const k in im) {
          if (/gestur|pinch|drag|_isZoom|_isPan|scal/i.test(k)) {
            const v = im[k];
            if (v !== null && typeof v !== "object" && typeof v !== "function") {
              const kk = k.length > 22 ? k.slice(-22) : k;
              const vv = typeof v === "number" ? v.toFixed(2) : String(v);
              out.push(`${kk}=${vv}`);
            }
          }
        }
        return out.join("\n") || "(該当なし)";
      } catch {
        return "(読取失敗)";
      }
    };

    const dumpTimer = setInterval(() => {
      const s = buildDump();
      dumpRef.current = s;
      setDump(s);
    }, 200);

    const onTouch = (name: string) => (e: TouchEvent) => {
      curFingers = e.touches.length;
      if (curFingers > maxSeen) maxSeen = curFingers;
      setInfo({ raw: curFingers, max: maxSeen, last: `${name}:${curFingers}` });
    };
    const s = onTouch("start"), m = onTouch("move"), en = onTouch("end"), c = onTouch("cancel");
    const opt = { capture: true, passive: true } as AddEventListenerOptions;
    document.addEventListener("touchstart", s, opt);
    document.addEventListener("touchmove", m, opt);
    document.addEventListener("touchend", en, opt);
    document.addEventListener("touchcancel", c, opt);
    return () => {
      clearInterval(dumpTimer);
      document.removeEventListener("touchstart", s, opt);
      document.removeEventListener("touchmove", m, opt);
      document.removeEventListener("touchend", en, opt);
      document.removeEventListener("touchcancel", c, opt);
    };
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        zIndex: 3000,
        background: frozen ? "rgba(200,20,20,0.95)" : "rgba(20,20,20,0.85)",
        color: "#fff",
        font: "600 10px/1.35 monospace",
        padding: "6px 8px",
        borderRadius: 8,
        whiteSpace: "pre",
        maxWidth: "66vw",
        pointerEvents: "auto",
      }}
    >
      <div style={{ pointerEvents: "none" }}>
        {`指:${info.raw} 最大:${info.max}\n---LIVE---\n${dump}`}
      </div>
      {/* ★バグった状態でこのボタンをタップ → その瞬間の状態を凍結記録 */}
      <button
        onClick={() => setFrozen(frozen ? null : dumpRef.current)}
        style={{
          marginTop: 6,
          width: "100%",
          background: frozen ? "#fff" : "#B3261E",
          color: frozen ? "#B3261E" : "#fff",
          border: "none",
          borderRadius: 6,
          padding: "6px 4px",
          font: "700 11px monospace",
        }}
      >
        {frozen ? "解除(もう一度記録)" : "◀バグった今を記録"}
      </button>
      {frozen && (
        <div style={{ marginTop: 6, pointerEvents: "none" }}>
          {`===記録===\n${frozen}`}
        </div>
      )}
    </div>
  );
}


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
  // 🛑 Safariの「ページごと拡大」ピンチを無効化（2026-07-20 最重要修正）
  //
  // iPhoneのSafariは、viewportで拡大禁止を指定しても【無視して】
  // ページ拡大のピンチを受け付ける（iOSのアクセシビリティ仕様）。
  // 指が凡例・Gボタン・ヘッダー等、地図以外の要素に少しでもかかった
  // ピンチをSafariが「ページ拡大」として横取りすると、その瞬間に
  // 地図へのタッチ通知が打ち切られ、MapKitの指の帳簿が狂う。
  // → 幻の指が残り「1本指なぞりでズームする」「2本指が無反応」
  //   「タップが効かない」という一連の壊れ方の根本原因だった。
  //   （ヘッダーを掴むと画面全体が拡大する、という以前の報告が
  //     このページ拡大が生きている動かぬ証拠だった）
  //
  // Safari独自の gesturestart / gesturechange をpreventDefaultすると、
  // ページ拡大だけが無効になる。地図自身のピンチ(MapKitのズーム)は
  // タッチイベントで別処理なので、従来通り動く。
  // 大島てる等の地図サイトが壊れないのは、これをやっているから。
  // ============================================================
  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", prevent, { passive: false } as AddEventListenerOptions);
    document.addEventListener("gesturechange", prevent, { passive: false } as AddEventListenerOptions);

    return () => {
      document.removeEventListener("gesturestart", prevent);
      document.removeEventListener("gesturechange", prevent);
    };
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
    /*
      ★2026-07-19 スマホ対応：height を 100vh → 100dvh に変更
      iPhoneのSafariでは 100vh がアドレスバーの裏まで含んだ高さになり、
      画面下のGボタンが見切れて、ページ全体をスライドしないと見えなかった。
      100dvh（実際に見えている高さ）にすると、常に画面内に収まる。
    */
    <main style={{ width: "100vw", height: "100dvh", display: "flex", flexDirection: "column", touchAction: "none" }}>
      <header style={{
        background: "white",
        padding: "12px 16px",
        borderBottom: "1px solid #eee",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        {/* ============================================================
            ★2026-07-19：デザイン確認用のダミー配置★
            ☰＝ハンバーガーメニュー（まだ押しても何も起きない）
            🪳アイコン＝roach-icon.png（高さはheightの数値で調整）
            本実装（メニューの中身）は別途。不要になったら☰やimgの
            ブロックを消すだけでよい。
           ============================================================ */}
        <button
          aria-label="メニュー（準備中）"
          style={{
            border: "none",
            background: "transparent",
            fontSize: "22px",
            color: "#662510",
            cursor: "pointer",
            padding: "0 4px",
            lineHeight: 1,
          }}
        >
          ☰
        </button>
        <img src="/roach-icon.png" alt="" style={{ height: "22px", width: "auto" }} />
        <h1 style={{ margin: 0, fontSize: "20px", fontWeight: "bold", color: "#292524" }}>
          ゴキブリマップ
        </h1>
      </header>
      {/*
        ★2026-07-20：touchAction:"none" ＝この領域のタッチをブラウザに
        一切解釈させない（地図サイトの標準装備）。ページピンチ拡大は
        gesturestart対策で殺したが、Safariには「ダブルタップ拡大」も残って
        いて、ピンチ連打の置いて離しての連続がダブルタップと誤認されると
        タッチが打ち切られ、幻の指が再発する。これで横取りを全種類遮断。
        地図・凡例・Gボタンのタップ動作はJS処理なので影響なし。
      */}
      <div style={{ flex: 1, position: "relative", touchAction: "none" }}>
        {/* ============================================================
            🔬 タッチ観測HUD（デバッグ用・2026-07-20）
            スマホ実機で、バグ発生の瞬間に「今どうなっているか」を画面で
            読むための一時的な計器。原因が確定したら丸ごと削除する。

            表示する値：
            ・raw   ：ブラウザが認識している"今触れている生の指の本数"
                      （touchstart/move/endから集計。これが指を離しても
                       0に戻らなければ、ブラウザ側でタッチが取りこぼされている）
            ・max   ：これまでに同時に触れた最大本数
            ・last  ：最後に起きたタッチイベント名と本数
            ・stuck ：指を全部離した(生0)はずなのにイベント上まだ残っている
                      と判定された回数。1以上なら「取りこぼし」が起きた証拠
           ============================================================ */}
        <TouchDebugHUD />

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
              top: 16,
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
                color: "#292524", // ★2026-07-19：薄い#111→メイン文字色に統一
                fontWeight: 600,
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
                color: "#292524", // ★ズーム警告と同じ濃さに統一
                fontWeight: 600,
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
    // ★2026-07-19：下(bottom:120px)から上へ移動。凡例(左下)との被り回避＋
    //   タップの邪魔にならない位置として、住所検索バーの下に配置。
    //   ★【位置を微調整したいときはこのtopの数値を変える】★
    top: "64px",
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
    whiteSpace: "nowrap", // 白箱が文字幅に追従し、必ず1行で表示される
  }}>
    目撃した場所をタップしてください
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

  {/* 🪳★【Gボタンの位置はここ】bottom=下から、right=右からの距離(px) */}
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
