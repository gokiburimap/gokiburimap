"use client";

import { useEffect, useState } from "react";

// ============================================================
// 🍔 ハンバーガーメニュー（2026-07-23 追加）
//
// 構成：
//  ・ヘッダー右の□ボタン（テーマカラー枠）
//  ・タップで右からドロワーがスライドイン（幅は画面の80%、上限320px）
//  ・ドロワーの左側に半透明オーバーレイ。タップで閉じる
//  ・ハンバーガー再タップでも閉じる
//
// メニュー項目はここの MENU_ITEMS 配列を編集するだけで増減できる。
// 今は全部ダミーリンク（href="#"）。noteだけ外部タブで開く想定。
// ============================================================

// ============================================================
// メニュー項目の定義
//
// kind: "modal" → 地図の上にオーバーレイパネルを重ねて表示（別ページに
//        遷移しない。地図の状態(位置・ズーム等)を一切失わない）
// kind: "link"  → 通常の<a>リンク（現状は投稿方法・プライバシーポリシーは
//        まだページが無いのでダミー"#"のまま。noteだけ実URL・外部タブ）
//
// ★2026-07-24：「このサイトについて」をテストとしてmodal化。
//   中身(content)は仮テキスト。書き足すときはこのcontentを編集するだけでよい。
//   他の項目も同じ要領でkind:"modal"に切り替え可能。
// ============================================================
type MenuItem =
  | { label: string; kind: "link"; href: string; external?: boolean }
  | { label: string; kind: "modal"; modalKey: string; content: string };

const MENU_ITEMS: MenuItem[] = [
  { label: "投稿方法", kind: "link", href: "#" },
  {
    label: "このサイトについて",
    kind: "modal",
    modalKey: "about",
    content:
      "（ここは仮テキストです。後で本文に差し替えてください）\n\nゴキブリマップは、引っ越し前に物件・建物周辺のゴキブリ発生履歴を調べられる、ユーザー投稿型の地図サービスです。個別の建物を特定できないよう、複数件をまとめた匿名化された「霧」で目撃件数のおおまかな傾向だけをお見せする方式を採用しています。",
  },
  { label: "プライバシーポリシー", kind: "link", href: "#" },
  { label: "note", kind: "link", href: "https://note.com/gokiburimap", external: true },
];

export default function HeaderMenu() {
  const [open, setOpen] = useState(false);
  // ★2026-07-24追加：開いているオーバーレイパネルのキー（無ければnull）
  const [activeModal, setActiveModal] = useState<string | null>(null);

  // 今開いているモーダルの中身を探しておく
  const activeItem = MENU_ITEMS.find(
    (item) => item.kind === "modal" && item.modalKey === activeModal
  ) as Extract<MenuItem, { kind: "modal" }> | undefined;

  // 開いている間は背景（地図）のスクロール・タッチを止める
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      {/* ハンバーガーボタン本体（A案：枠なし太字） */}
      <button
        aria-label={open ? "メニューを閉じる" : "メニューを開く"}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 32,
          height: 32,
          border: "none",
          background: "transparent",
          color: "#662510",
          fontSize: 20,
          fontWeight: 700,
          lineHeight: 1,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        ☰
      </button>

      {/* オーバーレイ（ドロワーが開いている時だけ表示。タップで閉じる） */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            zIndex: 3000,
          }}
        />
      )}

      {/* ドロワー本体：右から80%（上限320px）でスライドイン */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100dvh",
          width: "min(80vw, 320px)",
          background: "#ffffff",
          zIndex: 3001,
          boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.25s ease-out",
          display: "flex",
          flexDirection: "column",
          // 地図側のtouchAction:"none"の影響を受けないようにする
          touchAction: "auto",
        }}
      >
        {/* ドロワー上部：見出し＋閉じるボタン */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px",
            borderBottom: "1px solid #eee",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 700, color: "#292524" }}>
            メニュー
          </span>
          <button
            aria-label="メニューを閉じる"
            onClick={() => setOpen(false)}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 22,
              color: "#662510",
              cursor: "pointer",
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* メニュー項目一覧 */}
        <nav style={{ padding: "8px 0", overflowY: "auto" }}>
          {MENU_ITEMS.map((item) =>
            item.kind === "modal" ? (
              <button
                key={item.label}
                onClick={() => {
                  // ドロワーを閉じてから、地図の上にオーバーレイパネルを開く
                  setOpen(false);
                  setActiveModal(item.modalKey);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "14px 20px",
                  fontSize: 15,
                  fontWeight: 600,
                  color: "#292524",
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid #eee",
                  cursor: "pointer",
                }}
              >
                {item.label}
              </button>
            ) : (
              <a
                key={item.label}
                href={item.href}
                target={item.external ? "_blank" : undefined}
                rel={item.external ? "noopener noreferrer" : undefined}
                onClick={() => setOpen(false)}
                style={{
                  display: "block",
                  padding: "14px 20px",
                  fontSize: 15,
                  fontWeight: 600,
                  color: "#292524",
                  textDecoration: "none",
                  borderBottom: "1px solid #eee",
                }}
              >
                {item.label}
              </a>
            )
          )}
        </nav>
      </div>

      {/* ============================================================
          🗺️ オーバーレイパネル（2026-07-24 追加）
          ★別ページに遷移せず、地図の上にそのまま重ねて表示する。
            <Map>コンポーネントは裏でマウントされたままなので、
            閉じれば位置・ズーム・霧の再描画キャッシュが一切失われない。
          ★中身を増やすときは、MENU_ITEMSのmodalKey付きの項目を
            増やすだけでよい（このJSXは共通で使い回す）。
         ============================================================ */}
      {activeItem && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "#ffffff",
            zIndex: 4000,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px",
              borderBottom: "1px solid #eee",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 700, color: "#292524" }}>
              {activeItem.label}
            </span>
            <button
              aria-label="閉じる"
              onClick={() => setActiveModal(null)}
              style={{
                border: "none",
                background: "transparent",
                fontSize: 22,
                color: "#662510",
                cursor: "pointer",
                lineHeight: 1,
                padding: 4,
              }}
            >
              ×
            </button>
          </div>
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "20px",
              fontSize: 14,
              lineHeight: 1.8,
              color: "#292524",
              whiteSpace: "pre-wrap",
            }}
          >
            {activeItem.content}
          </div>
        </div>
      )}
    </>
  );
}
