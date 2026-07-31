"use client";

import { useEffect, useRef, useState } from "react";
import Map from "./components/Map";
import ReportSidebar from "./components/ReportSidebar";
import HeaderMenu from "./components/HeaderMenu";

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

// ============================================================
// 📐【Gボタンと余白の調整はここ】(2026-07-30 統一)
//
// ★AppleMap.tsx の UI_SP / UI_PC と揃えること★
//   ・bottom は AppleMap.tsx の UI_SP.bottom / UI_PC.bottom と同じ数字。
//     ここが揃っていると、Gボタンと凡例の下端がぴったり並ぶ。
//   ・right は AppleMap.tsx の UI_SP.edge / UI_PC.edge と同じ数字。
//     ここが揃っていると、現在地ボタンとGボタンの右端が並ぶ。
//   ・HEADER_PAD はヘッダーの左右の余白。地図上のボタンと視覚的に
//     揃えるための値。ハンバーガーメニューを端に寄せすぎると押しにくい
//     ので、12ではなく16にしてある。
// ============================================================
const G_BOTTOM_SP = 30;
const G_BOTTOM_PC = 35;
const G_RIGHT = 12;
const HEADER_PAD = 16;

// ★Gボタンの円の直径。ラベルの箱もこの高さに揃えるので、
//   Gの文字と「目撃情報を報告する」の文字が必ず同じ高さに並ぶ。
//   ★AppleMap.tsx の UI_BOX_H と必ず同じ数字にすること★
//     （そうすると凡例の箱とも高さが揃う）
const G_SIZE = 52;

// 波紋の広がり。Gボタン(52px)に対する倍率。
// ★大きくすると画面の端で切れる★ 1.5だと右端で1pxほど欠けたため1.35にした。
const PULSE_SCALE = 1.35;

export default function Home() {
  const [step, setStep] = useState<Step>("idle");
  const [pos, setPos] = useState<ReportPos | null>(null);
  const [geoData, setGeoData] = useState<GeoData | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const mapRef = useRef<MapHandle | null>(null);
  const [showZoomWarning, setShowZoomWarning] = useState(false);

  // ============================================================
  // 📱 スマホ判定（2026-07-30 追加）
  // AppleMap.tsx / SearchBar.tsx と同じ基準（画面幅768px未満）。
  // Gボタンの下端をPCとスマホで変えるために使う。
  // ============================================================
  const [isMobileUI] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );

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

  // ============================================================
  // 🗺 地図がタップされた／住所が後から届いたときの処理
  //
  // ★2026-07-27 修正（住所が入らない不具合）★
  //
  // 【何が起きていたか】
  // AppleMap.tsx の performTapAction は onMapClick を2回呼ぶ。
  //   ①タップ直後      … onMapClick(lat, lng)          住所なし。ピンだけ立てる
  //   ②1秒前後あとで   … onMapClick(lat, lng, geoData) 住所が届いた
  // 旧実装は step が "selecting" か "dragging" のときしか受け取らず、
  // 利用者が②より先に「目撃情報を入力」を押して step が "inputting" に
  // なっていると、②の住所が【捨てられていた】。
  // ＝フォームが空欄のまま、待っても永久に入らない。
  //
  // ローカルでは逆ジオコーディングが速く、②が先に届いていたため
  // 気づけなかった。Vercelは米国リージョンで動くぶん遅く（1.25秒）、
  // 本番でだけ再現していた。
  //
  // 【もうひとつの問題】
  // ②で setPos({lat, lng}) を呼んでいたため、毎回「新しいオブジェクト」
  // になり、AppleMap側の useEffect([reportPos]) がピンを作り直していた。
  // ＝住所が届いた瞬間にピンがピカッと光る（吹き出しが開き直る）。
  // 住所が届いただけでピンの位置は動いていないので、setPosは不要。
  //
  // 【対処】
  //   ・住所だけが後から届いた場合は、setPos を呼ばず住所だけ差し込む
  //   ・step が "inputting" のときは、この経路では受け取らない
  //     （確定位置での取り直しを handleStartInput 側でやっているため、
  //       ドラッグ前の古い座標の結果で上書きしないようにする）
  // ============================================================
  const handleMapClick = (lat: number, lng: number, geo?: GeoData) => {
    if (step === "selecting") {
      setPos({ lat, lng });
      setGeoData(geo ?? null);
      setStep("dragging");
      return;
    }

    if (step === "dragging") {
      // 住所だけが後から届いた場合：ピンの位置には触らない
      if (geo) {
        setGeoData(geo);
        return;
      }
      // 位置を選び直すタップ：住所は取り直しになるので一度空にする
      setPos({ lat, lng });
      setGeoData(null);
    }
    // step === "inputting" のときは何もしない（下の handleStartInput 参照）
  };

  // ============================================================
  // 📝 「目撃情報を入力」が押されたとき
  //
  // ★2026-07-27 追加：確定した位置で住所を取り直す★
  //
  // 【なぜ必要か】
  // ピンは白い吹き出しをドラッグして動かせるが、ドラッグは
  // AppleMap.tsx 側で reportPosRef を直接書き換えているだけで、
  // 逆ジオコーディングを呼び直していない。そのため旧実装では、
  // ドラッグして位置を変えても【最初にタップした地点の住所】が
  // フォームに入ってしまい、位置と住所が食い違っていた。
  //
  // ここで取り直せば、フォームに入る住所は必ず確定位置のものになる。
  //
  // 【体感について】
  // フォーム自体は即座に開き、住所だけが少し遅れて入る。
  // ReportSidebar側は useEffect で受け取れるようにしてあるので、
  // 開いた後に届いても正しく反映される。
  //
  // 【失敗時】
  // 通信失敗・住所が取れなかった場合は、いま持っている住所を
  // そのまま残す（空欄になるより、少し古くても入っている方がよい。
  // 利用者が手で直せる）。
  // ============================================================
  const handleStartInput = async (lat: number, lng: number) => {
    setPos({ lat, lng });
    setStep("inputting");

    try {
      const res = await fetch(`/api/reverse-geocode?lat=${lat}&lon=${lng}`);
      const geo = await res.json();
      if (!geo?.error && !geo?.outOfService) {
        setGeoData(geo);
      }
    } catch {
      /* 通信失敗時は現在の住所を維持（手入力できる） */
    }
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
      <header
        className="app-header"
        style={{
          background: "white",
          borderBottom: "1px solid #eee",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          // ★2026-07-30：左右に余白を入れ、地図上のボタン（絞り込み・
          //   現在地）の端と視覚的に揃えた。数値は上の HEADER_PAD。
          //   ★ハンバーガーメニューを端に寄せすぎると押しにくくなるので、
          //     地図側の12ではなく16にしてある。押しにくければ上げること。
          paddingLeft: HEADER_PAD,
          paddingRight: HEADER_PAD,
        }}
      >
        {/* ============================================================
            ★2026-07-23：左＝🪳アイコン＋サイト名、右＝ハンバーガーメニュー
            ハンバーガーメニュー本体（開閉・ドロワー・項目一覧）は
            HeaderMenu.tsx に分離。項目の増減はそちらのMENU_ITEMSを編集。
           ============================================================ */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src="/roach-icon.png" alt="" style={{ height: "22px", width: "auto" }} />
          <h1 style={{ margin: 0, fontSize: "20px", fontWeight: "bold", color: "#292524" }}>
            ゴキブリマップ
          </h1>
        </div>
        {/* ★2026-07-29：投稿の流れに入っている間はメニューを出さない。
            Gボタン・検索バー・現在地ボタンと同じ条件で揃えてある。 */}
        {step === "idle" && !justPosted && <HeaderMenu />}
      </header>
      {/*
        ★2026-07-20：touchAction:"none" ＝この領域のタッチをブラウザに
        一切解釈させない（地図サイトの標準装備）。ページピンチ拡大は
        gesturestart対策で殺したが、Safariには「ダブルタップ拡大」も残って
        いて、ピンチ連打の置いて離しての連続がダブルタップと誤認されると
        タッチが打ち切られ、幻の指が再発する。これで横取りを全種類遮断。
        地図・凡例・Gボタンのタップ動作はJS処理なので影響なし。
      */}
      <div
        style={{
          flex: 1,
          position: "relative",
          touchAction: "none",
          // 地図上のUI文字（ズーム警告・タップ促し・白箱のボタン等）を
          // 長押しで選択・コピーできないようにする。投稿フォームは別領域
          // (ReportSidebar)なので、入力欄のコピー/ペーストには影響しない。
          userSelect: "none",
          WebkitUserSelect: "none",
          WebkitTouchCallout: "none",
        } as React.CSSProperties}
      >
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
            // （DB側はトリガーが集計表を自動で減らしている）
            setJustPosted(null);
            setRefreshTrigger(n => n + 1);
          }}
          onOutOfService={() => setShowOutOfServiceWarning(true)}
          adminKey={adminKey}
        />

        {/* 🔑 管理者モードのバッジ（押すと管理画面に戻れる）
            ★位置：住所検索バーの「下」に置く。上部に表示しつつ検索バーと
              被らないようにするための top 値。微調整はこの数値を変える。 */}
        {adminKey && (
          <a
            href="/admin"
            style={{
              position: "absolute",
              top: 64,
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

        {/* ★2026-07-29：確認画面が出ている間はGボタンを出さない。
            出したままだと、確認画面を飛ばして次の投稿に入れてしまい、
            前の投稿の削除トークンも失われる。 */}
        {step === "idle" && !justPosted && (
         <>
  <style>{`
    @keyframes pulse-ring {
      0% { transform: scale(0.95); opacity: 0.3; }
      100% { transform: scale(${PULSE_SCALE}); opacity: 0; }
    }
  `}</style>

  {/* 🪳★【Gボタンの位置はここ】★
      ★AppleMap.tsx の UI_SP / UI_PC と必ず揃えること★
        bottom … UI_SP.bottom / UI_PC.bottom と同じ数字（凡例と下端が揃う）
        right  … UI_SP.edge / UI_PC.edge と同じ数字（現在地ボタンと右端が揃う）
      調整は、このファイル上部の G_BOTTOM_SP / G_BOTTOM_PC / G_RIGHT で行う。 */}
  <div
    style={{
      position: "absolute",
      bottom: `${isMobileUI ? G_BOTTOM_SP : G_BOTTOM_PC}px`,
      right: `${G_RIGHT}px`,
      display: "flex",
      // ★2026-07-30：ラベルの箱と円をどちらも G_SIZE の高さに固定した
      //   ので、上端も下端も自動的に揃う。凡例の箱も同じ高さ。
      alignItems: "center",
      gap: "10px",
      zIndex: 500,
    }}
  >
    {/* ラベル部分
        ★2026-07-30：凡例（目撃件数の箱）と見た目を揃えた。
          余白・文字サイズ・角の丸み・文字色を同じにしてあるので、
          閉じた凡例とこのラベルの高さがぴったり並ぶ。
        ★半透明＋ぼかしをやめた理由★
          ここだけ半透明で他は不透明の白、という不統一があったうえ、
          地図の模様が透けて文字が読みにくくなっていたため。
        ★AppleMap.tsx の LEGEND_SP / LEGEND_PC を変えたら、ここも同じ
          数字に合わせること（padding / fontSize / borderRadius）。 */}
    <div
      style={{
        background: "#ffffff",
        borderRadius: "10px",
        // ★2026-07-30：上下の余白で高さを作る方式をやめ、円と同じ
        //   高さに固定した。文字は上下中央に置かれるので、Gの文字と
        //   同じ高さに並ぶ。凡例の箱とも高さが一致する。
        height: `${G_SIZE}px`,
        display: "flex",
        alignItems: "center",
        padding: "0 18px",
        boxShadow: "0 2px 14px rgba(0,0,0,0.1)",
        whiteSpace: "nowrap",
      }}
    >
      <div style={{ fontSize: "14px", fontWeight: 500, color: "#292524", lineHeight: 1.2 }}>
        目撃情報を報告する
      </div>
    </div>

    {/* ボタン部分 */}
    <div style={{ position: "relative", width: `${G_SIZE}px`, height: `${G_SIZE}px` }}>
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
