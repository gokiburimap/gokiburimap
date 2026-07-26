"use client";

import { useEffect, useState, type ReactNode } from "react";

// ============================================================
// 🍔 ハンバーガーメニュー（2026-07-23 追加 / 2026-07-25 プライバシーポリシー本文を追加
//    / 2026-07-26 「本サービスについて」追加 / 2026-07-26 「使い方ガイド」追加）
//
// 構成：
//  ・ヘッダー右の□ボタン（テーマカラー枠）
//  ・タップで右からドロワーがスライドイン（幅は画面の80%、上限320px）
//  ・ドロワーの左側に半透明オーバーレイ。タップで閉じる
//  ・ハンバーガー再タップでも閉じる
//
// メニュー項目はここの MENU_ITEMS 配列を編集するだけで増減できる。
// noteは実URL（https://note.com/gokiburimap）で外部タブに開く。
// ============================================================

// ------------------------------------------------------------
// オーバーレイパネル本文の最大幅（PestMap等を参考に、Web版で横に
// 広がりすぎないよう中央寄せにするための値）。
// ★幅を変えたいときはこの数値だけを書き換えればよい。
// スマホ（画面幅がこれより狭い場合）は今まで通り全幅で表示される。
// ------------------------------------------------------------
const PANEL_CONTENT_MAX_WIDTH = 640;

// ------------------------------------------------------------
// お問い合わせ先アドレス
// ★この1行を書き換えるだけで、使い方ガイド・プライバシーポリシーの
//   両方の記載に反映される。
// ★2026-07-26：使い方ガイドからも参照するようになったため、
//   ファイル上部に移動した（旧：プライバシーポリシー本文の直前）。
// ------------------------------------------------------------
const CONTACT_EMAIL = "gokiburimap@gmail.com";

// ------------------------------------------------------------
// ★★★ 要同期：色分けエリア表示の配色 ★★★
//
// AppleMap.tsx の COUNT_COLOR_BUCKETS から「色だけ」を書き写したもの。
// 使い方ガイドの凡例図（ColorLegendFigure）で使用する。
//
// ・片方を変更したら、必ずもう片方も変更すること。
//   （AppleMap.tsx を触りたくないという判断のため、あえて import せず
//     重複させている。ズレても地図側の動作には影響せず、ガイドの凡例の
//     色が古いままになるだけ）
// ・件数の閾値（1〜20件 等）はここには持たない。閾値は運用しながら
//   調整する可能性が高く、同期漏れが起きやすいため、ガイドの凡例では
//   「少ない → 多い」の並びだけを示す方針とした。
//   正確な件数は地図下部の凡例で確認できる。
// ------------------------------------------------------------
const GUIDE_LEGEND_COLORS = [
  "94, 189, 172", // 青緑
  "255, 209, 84", // 黄色
  "255, 140, 43", // オレンジ
  "224, 61, 40", // 赤
  "106, 64, 205", // 紫
];

// ------------------------------------------------------------
// オーバーレイパネル本文用の小さな見た目パーツ
// プライバシーポリシーのような長文・見出し付きの本文を、
// よくある規約ページのレイアウト（縦線付き見出し／段落ごとの
// 区切り線／重要箇所の囲み枠）に合わせて読みやすく表示する。
//
// 色は、ブランドカラー(#662510)を見出しの装飾（縦線）だけに使い、
// 文字色は本文用グレー(#292524)・補足用の薄いグレー(#78716C)の
// 2色だけに統一（納品メモの「ブランドカラー」定義に準拠）。
// ------------------------------------------------------------
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3
        style={{
          fontSize: 17,
          fontWeight: 700,
          color: "#292524",
          margin: "28px 0 12px",
          paddingLeft: 12,
          borderLeft: "4px solid #662510",
          lineHeight: 1.4,
        }}
      >
        {title}
      </h3>
      {children}
      <hr
        style={{
          border: "none",
          borderTop: "1px solid #eee",
          margin: "20px 0 0",
        }}
      />
    </section>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return (
    <p style={{ fontSize: 14, fontWeight: 700, color: "#292524", margin: "16px 0 6px" }}>
      {children}
    </p>
  );
}

function Paragraph({ children }: { children: ReactNode }) {
  return (
    <p style={{ fontSize: 14, lineHeight: 1.8, color: "#292524", margin: "0 0 8px" }}>
      {children}
    </p>
  );
}

function List({ children }: { children: ReactNode }) {
  return (
    <ul style={{ margin: "0 0 8px", padding: 0, listStyle: "none" }}>{children}</ul>
  );
}

// ★2026-07-26：marker プロパティを追加。
//   既定値は従来どおり「・」なので、プライバシーポリシー・本サービスに
//   ついての既存の表示には一切影響しない。
//   使い方ガイドの番号付き手順（1. 2. 3. …）でのみ marker を指定する。
function Item({ children, marker = "・" }: { children: ReactNode; marker?: string }) {
  return (
    <li
      style={{
        display: "flex",
        gap: 6,
        fontSize: 14,
        lineHeight: 1.8,
        color: "#292524",
        marginBottom: 6,
      }}
    >
      <span style={{ flexShrink: 0 }}>{marker}</span>
      <span>{children}</span>
    </li>
  );
}

// 重要な情報（お問い合わせ先・免責事項など）を枠で囲んで目立たせる
function Box({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid #eee",
        borderRadius: 8,
        padding: "14px 16px",
        background: "#fafaf9",
        margin: "8px 0",
      }}
    >
      {children}
    </div>
  );
}

// ------------------------------------------------------------
// 使い方ガイド用の図（★スクリーンショットではなくJSXで描画している）
//
// 画像ファイルを使わない理由：
//  ・地図のスクショには実在の地名・建物名が写り込むため、「建物を
//    特定する表示は行わない」という本サービスの方針と矛盾する
//  ・Apple Mapsの著作権表示（規約上削除不可）が入り込む
//  ・霧の濃さ・UIを変更するたびに撮り直しが必要になる
// JSXで組めば上記がすべて解消でき、パネル幅にも自動で追従する。
// ------------------------------------------------------------

// 🪳アイコン＋数字のバッジ（円モードの見た目の再現）
// ★実際の地図の描画（Canvas 2D で生成）と細部が違う場合は、
//   下の width / fontSize / border の値を調整すること。
function CountBadgeFigure() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "14px 0" }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: "#ffffff",
          border: "2px solid #662510",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 1,
          flexShrink: 0,
        }}
      >
        <img src="/roach-icon.png" alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#292524", lineHeight: 1 }}>36</span>
      </div>
      <p style={{ fontSize: 12, lineHeight: 1.7, color: "#78716C", margin: 0 }}>
        ※数字は、周辺にある目撃情報をまとめた件数です。
      </p>
    </div>
  );
}

// 色分けエリア表示の凡例（件数の表記は入れず、色の並びだけを示す）
function ColorLegendFigure() {
  return (
    <div style={{ margin: "14px 0" }}>
      <div
        style={{
          display: "flex",
          borderRadius: 6,
          overflow: "hidden",
          border: "1px solid #eee",
        }}
      >
        {GUIDE_LEGEND_COLORS.map((rgb) => (
          <div key={rgb} style={{ flex: 1, height: 22, background: `rgb(${rgb})` }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        <span style={{ fontSize: 12, color: "#78716C" }}>少ない</span>
        <span style={{ fontSize: 12, color: "#78716C" }}>多い</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// 使い方ガイド本文
// ★2026-07-26：相談を経て確定した内容を反映。
//   メニュー項目名を「投稿方法」→「使い方ガイド」に改称し、
//   link（ダミー）から modal に変更した。
//
// ★「絞り込み」のセクションは、日付での絞り込み機能を実装してから
//   公開すること。本番公開までに実装が間に合わない場合は、
//   <Section title="絞り込み"> のブロックを丸ごと削除すればよい
//   （他のセクションから独立させてあるため、削っても文章は成立する）。
//
// ★「清掃履歴（建物カルテ）」については、実装時に本セクションを追加する。
//   ただし建物名を表示する機能のため、追加時には
//   プライバシーポリシー・本サービスについての「建物が特定される
//   ピン表示は行っていません」という記述も同時に改訂すること。
// ------------------------------------------------------------
function HowToGuideContent() {
  return (
    <>
      <Section title="地図の見方">
        <Paragraph>
          ゴキブリマップを開くと、地図上に🪳アイコンと数字が表示されます。
        </Paragraph>

        <CountBadgeFigure />

        <Paragraph>
          地図を拡大していくと、アイコン表示が「色分けされたエリア」に切り替わります。色は周辺に集まっている目撃情報の件数によって変わり、件数が少ないところから順に、青緑・黄・オレンジ・赤・紫となります。
        </Paragraph>

        <ColorLegendFigure />

        <Paragraph>
          色分けエリア表示は、個別の投稿地点や建物が特定されないよう、一定の広がりを持たせて表示しています。なお、色の濃さは地域の衛生状態を評価したものではありません。人通りの多い場所や、関心を持つ方が多い地域ほど、投稿が集まりやすい傾向があります。
        </Paragraph>
      </Section>

      <Section title="投稿方法">
        <Paragraph>
          目撃した場所と日付をご報告いただくことで、地図に反映されます。会員登録は必要ありません。
        </Paragraph>
        <List>
          <Item marker="1.">
            <strong>地図を目撃した場所まで拡大する</strong>
            <br />
            ある程度ズームインしていないと投稿を開始できません。ズームが足りない場合は、案内が表示されます。
          </Item>
          <Item marker="2.">
            <strong>右下の「G」ボタンをタップする</strong>
            <br />
            「目撃した場所をタップしてください」という案内に変わります。
          </Item>
          <Item marker="3.">
            <strong>地図上の目撃した場所をタップする</strong>
            <br />
            タップした位置にピンが立ちます。
          </Item>
          <Item marker="4.">
            <strong>位置を調整する</strong>
            <br />
            白い吹き出しをドラッグすると、ピンの位置を細かく動かせます。
          </Item>
          <Item marker="5.">
            <strong>内容を入力して送信する</strong>
            <br />
            都道府県・市区町村・目撃した日付をご入力ください。住所は地図の位置から自動で入りますので、必要に応じて修正してください。詳細コメントは任意です。
          </Item>
          <Item marker="6.">
            <strong>投稿完了</strong>
            <br />
            投稿した場所に、確認用のピンが表示されます。
          </Item>
        </List>
        <Box>
          <p style={{ fontSize: 13, lineHeight: 1.8, color: "#292524", margin: 0 }}>
            確認用のピンは、投稿を終えた直後にのみ表示されます。ご自身で投稿を取り消せるのは、確認用のピンが表示されている間だけです。画面を閉じたり、ページを更新したりすると再表示できませんので、ご注意ください。
          </p>
        </Box>
      </Section>

      <Section title="絞り込み">
        <Paragraph>
          目撃した日付で、地図の表示を絞り込むことができます。「1年以内」「3か月以内」といった期間を選ぶと、期間内に目撃された情報だけが地図に表示されます。最近の状況を知りたいときにお使いください。
        </Paragraph>
      </Section>

      {/* 最後のセクションは区切り線が不要なので、Sectionを使わず直接記述 */}
      <h3
        style={{
          fontSize: 17,
          fontWeight: 700,
          color: "#292524",
          margin: "28px 0 12px",
          paddingLeft: 12,
          borderLeft: "4px solid #662510",
          lineHeight: 1.4,
        }}
      >
        ご利用にあたってのお願い
      </h3>
      <Paragraph>
        本サービスは、投稿してくださる皆さんによって成り立っています。気持ちよくご利用いただくために、次の点にご協力をお願いいたします。
      </Paragraph>
      <List>
        <Item>実際に目撃された場所と日付をご投稿ください。</Item>
        <Item>個人名や部屋番号など、特定の方を指し示す内容は書かないでください。</Item>
        <Item>誹謗中傷を目的とした投稿はご遠慮ください。</Item>
      </List>

      <SubHeading>投稿の削除</SubHeading>
      <Paragraph>
        ご自身の投稿は、投稿直後に表示される確認画面から取り消せます。確認画面を閉じた後の削除や、他の方の投稿についての削除のご希望は、お問い合わせ窓口までご連絡ください。内容を確認のうえ対応いたします。
      </Paragraph>
      <Paragraph>
        投稿の取り扱いについて詳しくは、プライバシーポリシーをご覧ください。
      </Paragraph>
      <Box>
        <Paragraph>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            style={{ color: "#292524", fontWeight: 700, textDecoration: "underline" }}
          >
            {CONTACT_EMAIL}
          </a>
        </Paragraph>
        <p style={{ fontSize: 12, color: "#78716C", margin: 0, lineHeight: 1.7 }}>
          お問い合わせの内容によっては、ご返信できない場合がございますので、あらかじめご了承ください。
        </p>
      </Box>
    </>
  );
}

// ------------------------------------------------------------
// プライバシーポリシー本文
// ★2026-07-25：デザインを見出し・区切り線・囲み枠のあるレイアウトに刷新。
//   文言を直したいときはこの関数の中だけを編集すればよい。
//   お問い合わせ先アドレスは、ファイル上部の CONTACT_EMAIL を書き換える
//   だけで全箇所に反映される。
// ------------------------------------------------------------
function PrivacyPolicyContent() {
  return (
    <>
      {/* ★2026-07-26：本文タイトルはヘッダーバーのラベルと重複するため削除。
          最終更新日から始める */}
      <p
        style={{
          fontSize: 12,
          color: "#78716C",
          textAlign: "center",
          margin: "4px 0 24px",
        }}
      >
        最終更新日：（公開日を記載）
      </p>

      <Paragraph>
        ゴキブリマップ（以下「本サービス」）は、ゴキブリの目撃情報を閲覧できる「投稿型の地図サービス」です。本サービスは個人情報の保護に関する法律、その他の関連法令を遵守し、収集する情報を適切に取り扱います。
      </Paragraph>

      <hr
        style={{
          border: "none",
          borderTop: "1px solid #eee",
          margin: "20px 0 0",
        }}
      />

      <Section title="収集する情報">
        <Paragraph>
          本サービスでは、次の情報を収集します。氏名・メールアドレスなど、会員登録に伴う個人情報は一切収集していません。
        </Paragraph>
        <SubHeading>【投稿時に入力いただく情報】</SubHeading>
        <List>
          <Item>目撃した場所（緯度・経度）</Item>
          <Item>目撃した日付</Item>
          <Item>都道府県・市区町村・住所（地図タップ位置から自動取得し、ご自身で確認・修正いただいたもの）</Item>
          <Item>詳細コメント（任意）</Item>
        </List>
        <SubHeading>【投稿時に自動的に記録する情報】</SubHeading>
        <List>
          <Item>IPアドレス</Item>
          <Item>ブラウザ情報（ユーザーエージェント）</Item>
          <Item>投稿日時</Item>
        </List>
      </Section>

      <Section title="公開される情報・公開されない情報">
        <List>
          <Item>
            地図上には、複数の投稿をまとめて匿名化した「色分けエリア表示」のみを表示し、個別の投稿地点を特定できる「ピン表示」は行っていません。
          </Item>
          <Item>
            住所や詳細コメントなど、場所の特定につながりうる情報は、公開用データとは別の領域で管理し、外部から読み出せない設計としています。
          </Item>
          <Item>IPアドレス・ブラウザ情報は公開せず、運営者のみが閲覧できる状態で保管しています。</Item>
        </List>
      </Section>

      <Section title="利用目的">
        <Paragraph>収集した情報は、次の目的にのみ使用します。</Paragraph>
        <List>
          <Item>投稿内容を匿名化した地図表示として提供するため</Item>
          <Item>不正な連続投稿を防ぐため</Item>
          <Item>投稿に関するトラブル（名誉毀損等の申し立て、発信者情報開示請求など）が生じた際に、法令に基づき対応するため</Item>
        </List>
        <Paragraph>上記以外の目的で情報を利用することはありません。</Paragraph>
      </Section>

      <Section title="外部サービスの利用">
        <Paragraph>
          本サービスは、次の外部サービスを利用しています。それぞれの情報の取り扱いは、各サービス提供者のプライバシーポリシーに基づきます。
        </Paragraph>
        <List>
          <Item><strong>Apple MapKit JS</strong> — 地図の表示に利用しています。</Item>
          <Item><strong>Yahoo! JAPAN リバースジオコーダAPI</strong> — タップした地点の住所を取得するために、位置情報（緯度・経度）を送信しています。</Item>
          <Item><strong>Nominatim（OpenStreetMap）</strong> — 住所検索の候補表示のために、入力された検索キーワードを送信しています。</Item>
          <Item><strong>Supabase</strong> — 投稿データの保存・配信を行うクラウド基盤として利用しています。</Item>
          <Item>
            <strong>Google Analytics</strong> — サイトの利用状況（アクセス数・閲覧ページなど）を把握するために利用しています。Cookieを使用してアクセス情報を取得し、Googleに送信しています。取得した情報の取り扱いはGoogleのプライバシーポリシーに準じます。
          </Item>
        </List>
        <Paragraph>
          なお、今後広告配信サービスを導入する場合があります。その際は、送信先・送信される情報・利用目的を明記のうえ、本ページを更新します。
        </Paragraph>
      </Section>

      <Section title="第三者への提供">
        <Paragraph>収集した情報は、次の場合を除いて第三者に提供することはありません。</Paragraph>
        <List>
          <Item>法令に基づく開示請求など、法的な手続きに従う必要がある場合</Item>
          <Item>利用者ご本人の同意がある場合</Item>
        </List>
        <Paragraph>情報を第三者に販売・貸与することは一切ありません。</Paragraph>
      </Section>

      <Section title="保存期間">
        <List>
          <Item>
            <strong>投稿内容（目撃場所・日付・コメント等）</strong> — 本サービスの性質上、原則として期限を定めず保存します。地図上の表示から除外した場合（削除依頼への対応等）も、トラブル対応や法的紛争に備え、記録として別途保管することがあります。
          </Item>
          <Item>
            <strong>IPアドレス・ブラウザ情報・投稿日時</strong> — 投稿から<strong>1年間</strong>保存し、期間経過後は順次削除します。
          </Item>
        </List>
      </Section>

      <Section title="投稿の削除について">
        <List>
          <Item>
            ご自身の投稿は、投稿直後にのみ表示される確認画面から削除可能です。この画面は一度閉じると再表示されませんので、あらかじめご了承ください。
          </Item>
          <Item>
            上記の確認画面が表示されない場合や、他の投稿の削除をご希望の場合は、お問い合わせ窓口までご連絡ください。内容を確認のうえ対応いたします。
          </Item>
          <Item>削除対応後も、トラブル対応や法的紛争に備え、投稿内容を記録として保管する場合があります。</Item>
          <Item>虚偽・悪意ある投稿と判断した場合は、運営の判断により地図上の表示から除外することがあります。</Item>
        </List>
      </Section>

      <Section title="投稿・情報に関するご本人の権利">
        <Paragraph>
          本サービスは会員登録を伴わず、個人を特定する情報は原則として収集していません。ご自身の投稿内容について、次のご請求を受け付けています。
        </Paragraph>
        <List>
          <Item><strong>投稿内容の訂正・削除の請求</strong> — 対象の投稿を特定できる情報（位置・日時・内容等）を添えてお問い合わせください。</Item>
          <Item><strong>IPアドレス等の記録に関する利用停止・消去の請求</strong> — 内容を確認のうえ、可能な範囲で対応いたします。</Item>
        </List>
        <Paragraph>お問い合わせの際は、ご本人または投稿者であることを確認できる情報の提供をお願いする場合があります。</Paragraph>
      </Section>

      <Section title="セキュリティ対策">
        <Paragraph>
          住所・詳細コメントなどの情報は、公開用のデータベースとは分離して保管し、外部から読み出せないようにしています。投稿の受付・削除などの処理は、運営側のみが利用できる仕組みを経由して行っています。
        </Paragraph>
      </Section>

      <Section title="お問い合わせ">
        <Box>
          <Paragraph>
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: "#292524", fontWeight: 700, textDecoration: "underline" }}>
              {CONTACT_EMAIL}
            </a>
          </Paragraph>
          <p style={{ fontSize: 12, color: "#78716C", margin: 0, lineHeight: 1.7 }}>
            お問い合わせの内容によっては、ご返信できない場合がございますので、あらかじめご了承ください。
          </p>
        </Box>
      </Section>

      <Section title="ポリシーの変更について">
        <Paragraph>
          本ポリシーは、サービス内容の変更や法令の改正等に応じて、予告なく変更する場合があります。変更後の内容は本ページに掲載します。
        </Paragraph>
      </Section>

      {/* 最後のセクションは区切り線が不要なので、Sectionを使わず直接記述 */}
      <h3
        style={{
          fontSize: 17,
          fontWeight: 700,
          color: "#292524",
          margin: "28px 0 12px",
          paddingLeft: 12,
          borderLeft: "4px solid #662510",
          lineHeight: 1.4,
        }}
      >
        免責事項
      </h3>
      <Box>
        <p style={{ fontSize: 13, lineHeight: 1.8, color: "#78716C", margin: 0 }}>
          本サービスに掲載される情報は、利用者の投稿に基づくものであり、正確性を保証するものではありません。本サービスの情報を利用したことにより生じた損害について、運営者は責任を負いません。
        </p>
      </Box>
    </>
  );
}

// ------------------------------------------------------------
// 「本サービスについて」本文
// ★2026-07-26：相談を経て確定した内容を反映。
//   プライバシーポリシーと同じ部品（Section/Paragraph/Box等）を再利用し、
//   デザインを揃えている。
// ★2026-07-26：冒頭の区切り線を削除（パネル上部のヘッダーバーの下線と
//   二重に見えていたため）。
// ------------------------------------------------------------
function AboutContent() {
  return (
    <>
      <Section title="サービスの目的">
        <Paragraph>
          ゴキブリマップは、ゴキブリの目撃情報を地図上に可視化した「投稿型の地図サービス」です。
        </Paragraph>
        <Paragraph>
          引越し前の環境チェックはもちろん、身の回りの衛生状況が気になるときにも、参考情報としてお役立ていただけます。
        </Paragraph>
        <Paragraph>
          なお、本サービスは特定の地域や施設を貶める目的のサービスではありません。情報をオープンに共有することで、住環境の改善につながることを目指しています。
        </Paragraph>
      </Section>

      <Section title="色分けエリア表示について">
        <Paragraph>
          本サービスでは、建物・施設を特定できるピン表示はあえて行わず、複数の投稿をまとめて匿名化した「色分けエリア表示」のみを掲載しています。
        </Paragraph>
        <Paragraph>
          特定の建物・施設が名指しで晒されることのないよう配慮した上で、ゴキブリの発生傾向という情報だけを、地域単位でお届けすることを目指しています。
        </Paragraph>
      </Section>

      <Section title="運営について">
        <Paragraph>
          ゴキブリマップは、個人が開発・運営しているサービスです。皆さんから寄せられる目撃情報の積み重ねにより、価値ある地図に育てていきたいと考えています。
        </Paragraph>
        <Paragraph>
          運営にあたっては誠実な対応を心がけていますが、掲載内容の正確性・完全性を保証するものではありません。ご不明な点やお気づきの点がございましたら、お問い合わせ窓口までお気軽にご連絡ください。
        </Paragraph>
      </Section>

      {/* 最後のセクションは区切り線が不要なので、Sectionを使わず直接記述 */}
      <h3
        style={{
          fontSize: 17,
          fontWeight: 700,
          color: "#292524",
          margin: "28px 0 12px",
          paddingLeft: 12,
          borderLeft: "4px solid #662510",
          lineHeight: 1.4,
        }}
      >
        運営者
      </h3>
      <Box>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "#fff",
              border: "1px solid #eee",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            <img src="/roach-icon.png" alt="" style={{ width: 32, height: 32, objectFit: "contain" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#292524" }}>
              ゴキブリマップ運営　ゴキ
            </span>
            {/* ★ここにお問い合わせ用アドレス・note等のURLを入れる（2行目） */}
            <span style={{ fontSize: 12, color: "#78716C" }}>
              （ここにアドレス・URLを記載）
            </span>
          </div>
        </div>
      </Box>
    </>
  );
}

// ============================================================
// メニュー項目の定義
//
// kind: "modal" → 地図の上にオーバーレイパネルを重ねて表示（別ページに
//        遷移しない。地図の状態(位置・ズーム等)を一切失わない）
// kind: "link"  → 通常の<a>リンク（noteは実URL・外部タブ）
//
// ★2026-07-25：「プライバシーポリシー」を本文込みでmodal化。
// ★2026-07-26：「このサイトについて」を「本サービスについて」に改称し、
//   本文込みでmodal化。
// ★2026-07-26：「投稿方法」を「使い方ガイド」に改称し、本文込みでmodal化。
//   （地図の見方・投稿方法・絞り込み・ご利用にあたってのお願い を含む）
//   文言を直すときは HowToGuideContent() / PrivacyPolicyContent() /
//   AboutContent() の中身を編集すればよい。
// ============================================================
type MenuItem =
  | { label: string; kind: "link"; href: string; external?: boolean }
  | { label: string; kind: "modal"; modalKey: string; content: ReactNode };

const MENU_ITEMS: MenuItem[] = [
  {
    label: "使い方ガイド",
    kind: "modal",
    modalKey: "guide",
    content: <HowToGuideContent />,
  },
  {
    label: "本サービスについて",
    kind: "modal",
    modalKey: "about",
    content: <AboutContent />,
  },
  {
    label: "プライバシーポリシー",
    kind: "modal",
    modalKey: "privacy",
    content: <PrivacyPolicyContent />,
  },
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
          🗺️ オーバーレイパネル（2026-07-24 追加 / 07-25 本文組み込み）
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
              padding: "16px 20px",
              borderBottom: "1px solid #eee",
              flexShrink: 0,
            }}
          >
            <div style={{ width: "100%", maxWidth: PANEL_CONTENT_MAX_WIDTH, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
          </div>
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "20px",
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: PANEL_CONTENT_MAX_WIDTH,
                margin: "0 auto",
                fontSize: 14,
                lineHeight: 1.8,
                color: "#292524",
                whiteSpace: "pre-wrap",
              }}
            >
              {activeItem.content}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

