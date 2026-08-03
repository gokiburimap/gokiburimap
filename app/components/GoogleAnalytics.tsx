// app/components/GoogleAnalytics.tsx
//
// ============================================================
// Googleアナリティクス（2026-08-03 追加）
//
// 訪問者数・流入元・端末などを計測する。
// プライバシーポリシーの「外部サービスの利用」に記載済み。
//
// ★測定IDは公開情報★
//   サイトのソースに書かれ、誰でも見られる。ADMIN_SECRET などとは
//   性質が異なるので、環境変数に隠す必要はない。
//
// 【計測しないもの】
//   ・投稿の件数（管理画面で見る）
//   ・投稿の内容や座標（そもそも送っていない）
//
// 【止めたいとき】
//   layout.tsx から <GoogleAnalytics /> の行を消す。
//   その場合、プライバシーポリシーの記載も削ること。
// ============================================================

"use client";

import Script from "next/script";

// ★測定ID。Googleアナリティクスの管理画面で確認できる
const GA_ID = "G-YT360DTQ8P";

export default function GoogleAnalytics() {
  return (
    <>
      {/* Googleが用意している計測用のプログラムを読み込む。
          strategy="afterInteractive" は「ページが操作できるように
          なってから読む」という指定。地図の表示を邪魔しないため。 */}
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_ID}');
        `}
      </Script>
    </>
  );
}
