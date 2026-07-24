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

const MENU_ITEMS = [
  { label: "投稿方法", href: "#", external: false },
  { label: "このサイトについて", href: "#", external: false },
  { label: "プライバシーポリシー", href: "#", external: false },
  { label: "note", href: "#", external: true }, // ★note記事ができたらURLをここに差し替え
];

export default function HeaderMenu() {
  const [open, setOpen] = useState(false);

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
          {MENU_ITEMS.map((item) => (
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
          ))}
        </nav>
      </div>
    </>
  );
}
