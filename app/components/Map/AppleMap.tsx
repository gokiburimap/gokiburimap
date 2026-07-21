"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import Supercluster from "supercluster";
import { supabase } from "../../lib/supabase";
import SearchBar from "../SearchBar";

// ============================================================
// 📝 Report の型（2026-07-18 収集項目の見直しに伴い更新）
//
// ★page.tsx / ReportSidebar.tsx にも同じ型がある。変えるときは3つとも揃えること。
//
// ★detail だけは特別★
//   DBの reports テーブルには存在しない。投稿直後に本人へ内容を見せる
//   ためだけに、メモリ上で持ち回す値。実体は report_details テーブル側に
//   あり、RLSでSELECTポリシーを作っていないので誰も読み出せない。
//
// ・地図(fetchReports)が実際に取得するのは id / lat / lng だけ。
//   それ以外の項目は、投稿直後の確認ピンでしか使わないので任意(?)にしてある。
// ============================================================
interface Report {
  id: number;
  lat: number;
  lng: number;
  nearby_count?: number; // ★2026-07-18 PostGIS：半径120m以内の投稿件数（DB側で事前計算）
  address?: string;
  occurred_on?: string; // "2026-07-18" 形式
  detail?: string;
  delete_token?: string; // ★確認ピンの取り消しボタン用。メモリ上だけの値
}

interface AppleMapProps {
  onMapClick: (lat: number, lng: number, geoData?: {
    prefecture: string;
    city: string;
    address: string;
  }) => void;
  reportPos: { lat: number; lng: number } | null;
  isSelecting: boolean;
  onStartInput: (lat: number, lng: number) => void;
  onCancel: () => void;
  refreshTrigger: number;
  // ============================================================
  // 🪳 投稿直後の確認ピン（2026-07-18 追加）
  //
  // 投稿が完了した直後だけ、その場にゴキブリアイコンを立てて
  // 投稿内容を吹き出しで見せるための prop。
  //
  // ★重要★ これは「Reactのstateに一時的に持っているだけ」の値なので、
  // ページを更新したり、サイトから離脱したりすると自動的に消える。
  // その後は通常通り霧だけが残る（＝ご要望の挙動そのもの）。
  // DBには一切保存しないし、他人には絶対に見えない。
  //
  // 親コンポーネント(page.tsx)側でやること：
  //   1. 投稿が成功したら justPosted に投稿内容をセットする
  //   2. 「閉じる」を押されたら onDismissJustPosted で null に戻す
  //   （詳細は納品メモを参照）
  // ============================================================
  justPosted?: Report | null;
  onDismissJustPosted?: () => void;
  // ============================================================
  // 🗑 確認ピンから投稿を取り消したときの通知（2026-07-18 追加）
  // 親(page.tsx)側で、確認ピンを消す＋地図を再読込（霧を消す）するのに使う。
  // ============================================================
  onJustPostedDeleted?: () => void;
  // ============================================================
  // 🔑 管理者モード（2026-07-19 追加）
  // 合言葉が渡されると、霧に加えて投稿1件ずつの📍ピンを表示する。
  // ピンをタップすると投稿内容（運営箱の住所・詳細込み）と削除ボタンが出る。
  // 座標や住所・詳細を返すAPIはサーバー側で合言葉を検証するため、
  // URLに?adminを付けただけの一般人には何も見えない。
  // ============================================================
  adminKey?: string | null;
  // ============================================================
  // 🚫 投稿できない場所をタップしたときの通知（2026-07-18 追加）
  //
  // 海外・海など、住所が取れない地点をタップしたときに親へ知らせる。
  // 親(page.tsx)側で、ズーム警告と同じ見た目の案内を出すのに使う。
  // 省略可能にしてあるので、渡さなくてもエラーにはならない。
  // ============================================================
  onOutOfService?: () => void;
}

export interface AppleMapHandle {
  isZoomedInEnough: () => boolean;
}

declare global {
  interface Window {
    mapkit: any;
  }
}

const ZOOM_THRESHOLD = 0.009;
const MAX_CLUSTER_ZOOM = 20;

// ============================================================
// ☁️ 雲形の適用ズームしきい値
// これ以上ズームインすると、通常の円ではなく雲形(もや)の表示に切り替える。
// ヒートマップとして「ピンポイントで指し示す」表現を避けるための境目。
// どれだけズームしても個別ピン(アイコン)には絶対に分解しない。
// ※ count===1（単独投稿）の場合は、このしきい値に関わらず常に雲になる
//   （renderMarkers内のクラスタごとの判定を参照）
//
// ★2026-07-18 注意★
// ズーム計算のバグ修正(下のcalcSuperclusterZoomを参照)により、
// この数値の意味が以前と変わっている。以前は実際より1〜1.5ほど
// 低い値が渡っていたため、同じ「16」でも切り替わるタイミングが
// 従来より早く(浅いズームで)訪れる。円のままでいてほしい範囲が
// 霧になってしまう場合は、この値を17〜18に上げて調整すること。
// ============================================================
const CLOUD_ZOOM_THRESHOLD = 16;

// ============================================================
// 🔠【②文字サイズの上限はここ】
// 円の中の数字が、円の拡大に引きずられて大きくなりすぎないようにする上限(px)。
// 数値を下げるほど、数字は控えめな大きさで頭打ちになる
// ============================================================
const MAX_CLUSTER_FONT_SIZE_PX = 18;

// ============================================================
// 🔵【③円モードのサイズ上限はここ】
// 数値を下げるほど、円が最大までズームしても大きくなりすぎなくなる
// ★2026-07-17：🪳アイコン化に伴い、ズームイン時に大きくなりすぎるとの
// フィードバックを受けて140→100に下げた
// ============================================================
const MAX_CIRCLE_DISPLAY_SIZE_PX = 100;

// ============================================================
// ☁️【霧の「件数による伸び分」の上限はここ】
//
// ★2026-07-18 意味が変わったので注意★
// 以前はこの値が「霧の大きさそのものの上限」だったため、
// 法的リスク対策の最低保証半径(MIN_COVERAGE_RADIUS_METERS)を
// この値が上書きして潰してしまい、保証半径が機能していなかった。
//
// 現在は「件数が増えたときに、土台からどこまで大きく育てるか」
// の上限としてだけ効く。土台(最低保証半径)は絶対に削らない。
//
// 上げる → 件数の多い場所が、より大きく育つ
// 下げる → 件数が多くても、そこまで大きくならない
// ============================================================
const MAX_CLOUD_DISPLAY_SIZE_PX = 220;

// ============================================================
// ☁️【安全弁】霧の絶対上限(px)
//
// 最低保証半径を守る設計にした結果、深くズームすると霧が
// 画面より大きくなり、Canvasが巨大化して動作が重くなることがある。
// それを防ぐための最後のストッパー。
//
// 通常は発動しない。動作が重いと感じたときだけ下げること。
// ★これを下げすぎると、また最低保証半径が潰れてしまうので注意★
// ============================================================
const HARD_MAX_CLOUD_PX = 700;

// ============================================================
// 🎨 目撃件数による色分け（2026-07-16新規実装）
//
// 東京都の犯罪情報マップ（警視庁）の5段階の閾値の分け方を参考にしつつ、
// 配色は気象庁の降水強度マップ等を参考にした多色相スケール
// （青緑→黄→オレンジ→赤→紫）を採用している。
// 閾値・色を変えたい場合は、この配列の値を書き換えるだけでよい。
//
// ※ 色分けは霧モードのみに適用する。円(🪳アイコン)モードは
//   ブランドカラー固定で色分けしない（①の方針）
// ※ RGB値は "R, G, B" のカンマ区切り文字列にしてあるので、
//   rgba(${color}, opacity) の形でそのまま埋め込める
// ============================================================
interface CountColorBucket {
  maxCount: number; // この件数以下ならこのバケット
  rgb: string; // "R, G, B" 形式
  label: string; // 凡例表示用
}

const COUNT_COLOR_BUCKETS: CountColorBucket[] = [
  { maxCount: 20, rgb: "94, 189, 172", label: "1〜20件" }, // 青緑
  { maxCount: 40, rgb: "255, 209, 84", label: "21〜40件" }, // 黄色
  { maxCount: 60, rgb: "255, 140, 43", label: "41〜60件" }, // オレンジ
  { maxCount: 80, rgb: "224, 61, 40", label: "61〜80件" }, // 赤
  { maxCount: Infinity, rgb: "106, 64, 205", label: "81件以上" }, // 紫
];

function getColorRgbForCount(count: number): string {
  const bucket = COUNT_COLOR_BUCKETS.find((b) => count <= b.maxCount);
  return bucket ? bucket.rgb : COUNT_COLOR_BUCKETS[COUNT_COLOR_BUCKETS.length - 1].rgb;
}

// ============================================================
// 🪳 ゴキブリアイコン＋件数表示方式（2026-07-17）
//
// 数字の置き方は2パターン用意し、CLUSTER_NUMBER_STYLE の値だけで
// 切り替えて比較できるようにしてある。
//
// ・"center"：🪳の中央に、白文字＋濃い縁取り(アウトライン)で数字を重ねる
// ・"badge" ：右下に小さな丸バッジ(ブランドカラー)を乗せて、その中に数字を描く
//
// ・件数が2件以上のときだけ数字を表示する（1件はゴキブリアイコンのみ）
// ・数字の色/縁取り色は件数による色分けの対象外。ブランドカラー系で固定
// ============================================================
const CLUSTER_NUMBER_STYLE: "center" | "badge" = "center";

// ============================================================
// 🪳 ゴキブリアイコン画像（2026-07-17 追加）
//
// 【画像ファイルの配置】
// public/roach-icon.png に置くこと。元の色のまま使いたい場合は
// public/roach-icon-original.png もあるので、ROACH_ICON_URL の値を
// そちらに差し替えるだけでよい。
//
// 【非同期ロードの扱い】
// 画像はブラウザが読み込むまで一瞬時間がかかるため、ロード未完了の間は
// 絵文字にフォールバックする。ロード完了後は、アイコンキャッシュを
// 一度クリアし、絵文字で描画済みのアイコンも画像版に描き直させる。
// ============================================================
const ROACH_ICON_URL = "/roach-icon.png";
// アップロードされたイラストの実寸（トリミング後）: 490 x 677px
const ROACH_ASPECT_RATIO = 677 / 490; // height / width
// 【触角・脚が切れない範囲でどれだけ大きく見せるか】
// Canvas(size×size)に対する充填率。1.0に近づけるほど大きく見えるが、
// 上げすぎると触角・脚が問答無用で切り取られる。欠ける場合は下げること。
// 「もっと大きく見せたい」場合は、ここではなくアイコン自体の実寸
// (calcCircleSize・MAX_CIRCLE_DISPLAY_SIZE_PX)を調整する。
const ROACH_FILL_RATIO = 0.92;

let roachImageEl: HTMLImageElement | null = null;
let roachImageLoadPromise: Promise<HTMLImageElement> | null = null;

function loadRoachImage(): Promise<HTMLImageElement> {
  if (roachImageEl) return Promise.resolve(roachImageEl);
  if (roachImageLoadPromise) return roachImageLoadPromise;

  roachImageLoadPromise = new Promise((resolve, reject) => {
    const img = new Image();
    // 取得優先度のヒント（対応ブラウザのみ有効）
    (img as any).fetchPriority = "high";
    img.decoding = "async";
    img.onload = () => {
      // 描画直前のデコード待ちによるカクつきを防ぐため、先にデコードしておく
      const finish = () => {
        roachImageEl = img;
        resolve(img);
      };
      if (typeof img.decode === "function") {
        img.decode().then(finish).catch(finish);
      } else {
        finish();
      }
    };
    img.onerror = reject;
    img.src = ROACH_ICON_URL;
  });
  return roachImageLoadPromise;
}

// モジュール読み込み時点（JS実行開始時点）で画像の取得を始めておく。
// コンポーネントのuseEffect(初回描画後)を待たないぶん、体感が速くなる。
if (typeof window !== "undefined") {
  loadRoachImage().catch(() => {
    /* 失敗しても絵文字にフォールバックするので握りつぶす */
  });
}

const createClusterIconUrl = (count: number, size: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    // 🪳本体を中央に描画。画像がロード済みならPNGを、未ロードなら絵文字にフォールバック
    if (roachImageEl) {
      // ★ここをsizeより大きくすると、Canvas自体がsize×sizeぴったりの
      // サイズしかないため、はみ出した部分(触角・脚など中心から遠いパーツ)が
      // 問答無用で切り取られる。ここは1.0未満の値に留めること。
      const maxBox = size * ROACH_FILL_RATIO;
      let drawWidth: number;
      let drawHeight: number;
      if (ROACH_ASPECT_RATIO >= 1) {
        drawHeight = maxBox;
        drawWidth = maxBox / ROACH_ASPECT_RATIO;
      } else {
        drawWidth = maxBox;
        drawHeight = maxBox * ROACH_ASPECT_RATIO;
      }
      ctx.drawImage(
        roachImageEl,
        (size - drawWidth) / 2,
        (size - drawHeight) / 2,
        drawWidth,
        drawHeight
      );
    } else {
      const emojiSize = Math.round(size * 0.75);
      ctx.font = `${emojiSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("🪳", size / 2, size / 2 + size * 0.03);
    }

    // ①1件だけの時は数字を描かない(ヒートマップとして「1」を表示する意味が薄いため)
    if (count > 1) {
      const digits = String(count).length;

      if (CLUSTER_NUMBER_STYLE === "center") {
        // 中央配置：白文字＋濃い縁取りで、アイコンの上に重ねても読めるようにする
        const calculatedFontSize = Math.round(size * (digits <= 2 ? 0.4 : 0.28));
        const finalFontSize = Math.min(calculatedFontSize, MAX_CLUSTER_FONT_SIZE_PX + 4);

        ctx.font = `bold ${finalFontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;

        // 縁取り(アウトライン)を先に描いてから、白でfillする
        ctx.lineWidth = Math.max(Math.round(finalFontSize * 0.22), 2);
        ctx.strokeStyle = "rgba(41, 37, 36, 0.9)"; // メイン文字色(#292524)に合わせた濃色
        ctx.strokeText(String(count), size / 2, size / 2);

        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(String(count), size / 2, size / 2);
      } else {
        // バッジ配置：右下に小さな丸バッジを乗せて、その中に数字を描く
        const badgeRadius = Math.max(Math.round(size * 0.24), 9);
        const badgeCenterX = size - badgeRadius - size * 0.04;
        const badgeCenterY = size - badgeRadius - size * 0.04;

        ctx.beginPath();
        ctx.arc(badgeCenterX, badgeCenterY, badgeRadius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(102, 37, 16, 1)"; // ブランドカラー固定
        ctx.fill();
        ctx.lineWidth = Math.max(Math.round(size * 0.02), 1);
        ctx.strokeStyle = "#FFFFFF";
        ctx.stroke();

        ctx.fillStyle = "#FFFFFF";
        const calculatedFontSize = Math.round(badgeRadius * (digits <= 2 ? 1.1 : 0.85));
        const finalFontSize = Math.min(calculatedFontSize, MAX_CLUSTER_FONT_SIZE_PX);

        ctx.font = `bold ${finalFontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(count), badgeCenterX, badgeCenterY);
      }
    }
  }
  return canvas.toDataURL();
};

const clusterIconCache = new Map<string, string>();
const CLUSTER_CACHE_MAX = 400;
const CLUSTER_SIZE_QUANTUM = 4;
function getCachedClusterIconUrl(count: number, size: number) {
  // 霧と同じく、ズームで連続変化するsizeを刻みに丸めて蓄積を防ぐ
  const qSize = Math.max(CLUSTER_SIZE_QUANTUM, Math.round(size / CLUSTER_SIZE_QUANTUM) * CLUSTER_SIZE_QUANTUM);
  const key = `c_${count}_${qSize}`;
  let icon = clusterIconCache.get(key);
  if (!icon) {
    icon = createClusterIconUrl(count, qSize);
    if (clusterIconCache.size >= CLUSTER_CACHE_MAX) {
      const oldestKey = clusterIconCache.keys().next().value;
      if (oldestKey !== undefined) clusterIconCache.delete(oldestKey);
    }
    clusterIconCache.set(key, icon);
  }
  return icon;
}

// シンプルな seeded random（同じseedなら毎回同じ乱数列を返す）
// クラスタIDをseedにすることで、パン/ズームで再描画されても
// 同じクラスタの雲の形が毎回変わらないようにする
function seededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ============================================================
// 🎯 中心オフセット：実際の投稿座標と、霧の表示中心をわずかにずらす
//
// 霧の輪郭自体はすでに不定形（もや状）にしているが、輪郭を歪ませる際の
// 基準点（中心）は、これまで常に投稿座標そのものと一致していた。
// これだと「霧の中心が毎回正確に建物の真上に来る」という再現性のある
// 状態になってしまうため、中心自体もseed固定でごくわずかにずらす。
//
// ずらす量は、最低保証半径(MIN_COVERAGE_RADIUS_METERS)に対して
// 十分小さい値に留めること。ずらしすぎると、実際の建物が霧の範囲外に
// はみ出し、「無関係の隣の建物を指しているように見える」という別の
// 問題（不正確な表示による誤解）を生むため。
// 【初期値】4m
// ============================================================
const OFFSET_MAX_METERS = 4;

function calcOffsetLatLng(seed: number, atLat: number) {
  // 雲の輪郭生成(seededRandom(seed))とは別系統の乱数列にするため、seed+1を使う
  const rand = seededRandom(seed + 1);
  const angle = rand() * Math.PI * 2;
  const distance = rand() * OFFSET_MAX_METERS;

  const METERS_PER_DEGREE_LAT = 111320;
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos((atLat * Math.PI) / 180);

  const deltaLat = (Math.sin(angle) * distance) / METERS_PER_DEGREE_LAT;
  const deltaLng = (Math.cos(angle) * distance) / metersPerDegreeLng;

  return { deltaLat, deltaLng };
}

// 雲形（もや）アイコンを作る関数
// 天気予報の雨雲のような、輪郭が不定形でぼんやりした形にする。
// 塗りは1回だけ(=濃淡は均一)にし、透明度は建物がうっすら透けて見える程度に抑える。
// 数字は出さない（ヒートマップとして濃淡だけで件数を表現するため）
//
// ★2026-07-18 PostGIS対応：引数を分けた★
// ・count      ：クラスタにまとまっている投稿数 → 濃さ(opacity)に使う
// ・colorCount ：半径120m以内の固定カウント(nearby_count由来) → 色に使う
// 色がズームで変わる問題の解消のため、色だけcolorCountで決める。
function createCloudIconUrl(count: number, colorCount: number, size: number, seed: number) {
  const PADDING = size * 0.4;
  const canvasSize = size + PADDING * 2;

  const canvas = document.createElement("canvas");
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas.toDataURL();

  const rand = seededRandom(seed);

  // ============================================================
  // 【③霧の濃さはここ】
  //
  // ★現在は「投稿したことが分かりやすいように」動作確認用の
  //   濃い設定(0.5〜0.9)になっている。本番前に必ず戻すこと。
  //   本番の目安： MIN 0.1 / MAX 0.3（建物がうっすら透ける濃さ）
  //
  // MIN_CLOUD_OPACITY : 1件目の濃さ
  // MAX_CLOUD_OPACITY : 件数が増えたときの濃さの天井
  // 係数(0.12)        : 少ない件数でも濃さの変化を速く出したいなら上げる
  // ============================================================
  const MIN_CLOUD_OPACITY = 0.5;
  const MAX_CLOUD_OPACITY = 0.9;
  const baseOpacity = Math.min(
    MIN_CLOUD_OPACITY + Math.log10(count) * 0.12,
    MAX_CLOUD_OPACITY
  );

  // ★色分け：件数バケットに応じた色（getColorRgbForCount）を使う。
  // 濃さ(baseOpacity)の計算とは独立して、色相そのものを件数で変える。
  // ★2026-07-18：色はcount(クラスタの投稿数)ではなく、
  //   colorCount(半径120mの固定カウント)で決める。ズームで色が変わらない。
  const colorRgb = getColorRgbForCount(colorCount);

  const centerX = canvasSize / 2;
  const centerY = canvasSize / 2;
  const baseRadius = size / 2;

  // ------------------------------------------------------------
  // 【①均一にするための肝】
  // 塊を重ね塗りするのではなく、一旦「輪郭だけ歪んだ形」をパス(path)として
  // つなぎ合わせ、最後に1回だけfillする。これで中心も外周も同じ塗り1回になる
  // ------------------------------------------------------------
  const pointCount = 10; // 輪郭を構成する頂点の数。多いほど滑らか、少ないほどゴツゴツ
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < pointCount; i++) {
    const angle = (Math.PI * 2 * i) / pointCount;
    // 各頂点ごとに半径をランダムに揺らし、正円から歪ませる
    const r = baseRadius * (0.65 + rand() * 0.6);
    points.push({
      x: centerX + Math.cos(angle) * r,
      y: centerY + Math.sin(angle) * r,
    });
  }

  // ============================================================
  // ★2026-07-19 iPhone対応：霧のぼかし方式を変更
  //
  // 従来の ctx.filter = "blur(...)" は、iPhoneのSafariでは効かない環境が
  // あり、輪郭がぼけずに「ベタ塗り」に見えていた（PCでは霧に見えるのに
  // スマホだとベタ塗り、の原因はこれ）。
  //
  // 代わりに、どのブラウザでも確実に使える shadowBlur（影のぼかし）で描く。
  // 【仕組み】図形の本体をCanvasの遥か左外側に描き、その「影」だけを
  // Canvas内に落とす。影は輪郭がふんわりぼけるので、霧の見た目になる。
  // PCも同じ方式に統一したので、PC/スマホで見た目が揃う。
  // 【ぼかしの強さを変えたいときは ctx.shadowBlur の係数(0.15)を変える】
  // ============================================================
  const SHADOW_SHIFT = canvasSize * 2; // 本体をこれだけ左に追い出す

  ctx.save();
  ctx.shadowColor = `rgba(${colorRgb}, ${baseOpacity})`;
  ctx.shadowBlur = Math.round(size * 0.15);
  ctx.shadowOffsetX = SHADOW_SHIFT; // 影だけをCanvas内に戻す
  ctx.fillStyle = "rgba(0, 0, 0, 1)"; // 本体の色は何でもよい（描画されるのは影の色）

  // 頂点同士を、直線ではなく曲線(quadraticCurveTo)でつないで滑らかな不定形にする
  ctx.beginPath();
  ctx.moveTo(
    (points[0].x + points[pointCount - 1].x) / 2 - SHADOW_SHIFT,
    (points[0].y + points[pointCount - 1].y) / 2
  );
  for (let i = 0; i < pointCount; i++) {
    const current = points[i];
    const next = points[(i + 1) % pointCount];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    ctx.quadraticCurveTo(current.x - SHADOW_SHIFT, current.y, midX - SHADOW_SHIFT, midY);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  return canvas.toDataURL();
}

// ============================================================
// 霧画像のキャッシュ（2026-07-20 固まりバグの根本修正）
//
// 【症状】霧のある場所でピンチ(ズーム)を繰り返すと、そのうち地図が
// 固まり、スライドしてもズームしかできなくなる。
//
// 【原因】ピンチのズームは滑らかで、霧のsizeが 100,101,102… と1pxずつ
// 無数の値を取る。旧実装はキャッシュキーにsizeをそのまま使っていたため、
// 1pxごとに別画像を生成し、それが cloudIconCache に無限に溜まり続けて
// メモリを圧迫し、最後に固まっていた。移動(パン)ではsizeが変わらないので
// 溜まらず、ピンチのときだけ起きていた。
//
// 【対策1】sizeを SIZE_QUANTUM(px)刻みに丸める。連続ズームでも同じキーに
// 集約され、画像生成が激減する（見た目はほぼ変わらない）。
// 【対策2】キャッシュに上限(CACHE_MAX)を設け、超えたら古いものから捨てる。
// 無限蓄積を根本で止める。
// ============================================================
const cloudIconCache = new Map<string, string>();
const CLOUD_CACHE_MAX = 400;   // 保持する霧画像の最大数
const SIZE_QUANTUM = 8;        // 霧サイズをこのpx刻みに丸める

function getCachedCloudIconUrl(count: number, colorCount: number, size: number, seed: number) {
  // サイズを刻みに丸める（ピンチの連続値を段階に集約してキャッシュを効かせる）
  const qSize = Math.max(SIZE_QUANTUM, Math.round(size / SIZE_QUANTUM) * SIZE_QUANTUM);

  // ★キャッシュキーにcolorCountも含める。同じ件数・サイズ・形でも
  //   色が違えば別の画像なので、混ざらないようにする
  const key = `cloud_${count}_${colorCount}_${qSize}_${seed}`;
  let icon = cloudIconCache.get(key);
  if (!icon) {
    icon = createCloudIconUrl(count, colorCount, qSize, seed);
    // 上限を超えたら、最も古いエントリ(Mapは挿入順)から捨てる
    if (cloudIconCache.size >= CLOUD_CACHE_MAX) {
      const oldestKey = cloudIconCache.keys().next().value;
      if (oldestKey !== undefined) cloudIconCache.delete(oldestKey);
    }
    cloudIconCache.set(key, icon);
  }
  return icon;
}

// ④【円の大きさはここで調整】
// ★2026-07-17：🪳アイコン化に伴い、俯瞰時(ズームアウト)に小さすぎず、
// ズームイン時に大きくなりすぎないよう、下限を上げ・上限を下げて範囲を狭めた。
function calcCircleSize(count: number) {
  const countBonus = Math.log10(count + 1) * 8;
  return Math.round(Math.min(46 + countBonus, 90));
}

// ============================================================
// ☁️ 霧モード専用：件数に応じた追加サイズ（最低保証半径への上乗せ分）
//
// 霧モードは「最低保証サイズ＋この関数の戻り値」という加算方式。
// 件数1件のときは追加0px（＝最低保証サイズそのまま、法的リスク対策は維持）、
// 件数が増えるごとに対数スケールで緩やかに大きくしていく。
//
// 【調整したい場合】倍率(26)を上げるほど、少ない件数でも大きく育つようになる
// ============================================================
function calcCloudGrowthPx(count: number) {
  return Math.round(Math.log2(count) * 26);
}

// ============================================================
// 🛡【①1投稿あたりの霧の大きさはここ】法的リスク対策：最低保証半径
//
// 「円/雲が実質1棟しかカバーしていない」状態を避けるため、
// 現在のズーム倍率がどうであれ、実世界でこのメートル数ぶんの
// 半径は必ずカバーするよう、画面px換算した下限サイズを計算する。
//
// ★★ 霧を大きくしたいときは、この数値を上げる ★★
//   120 → 150 → 200 … のように少しずつ上げて、実機で確認すること。
//
// 【2026-07-18 修正済み】
// 以前はMAX_CLOUD_DISPLAY_SIZE_PX(220px)がこの値を上書きして
// 潰していたため、この数値を上げても見た目が一切変わらなかった。
// （実効の保証半径は46m前後まで縮んでいた）
// 現在は土台として必ず効くようになっている。
//
// 【逆に「大きすぎる」と感じたときの注意】
// この値を下げるのではなく、MIN_CAMERA_DISTANCE_METERS(下方にある)を
// 上げてズームを浅く制限すること。この値を下げると法的リスク対策が
// 薄まるが、ズーム制限を強めるほうは対策が強まる方向なので一石二鳥。
// この2つはセットで調整するもの、と覚えておけばよい。
// ============================================================
const MIN_COVERAGE_RADIUS_METERS = 120;

function calcMinCoverageSizePx(map: any, containerEl: HTMLDivElement | null): number {
  if (!containerEl) return 0;

  const span = map.region.span;
  const centerLat = map.region.center.latitude;

  // 緯度1度・経度1度あたりのおおよそのメートル数（経度は緯度によって縮む）
  const METERS_PER_DEGREE_LAT = 111320;
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos((centerLat * Math.PI) / 180);

  const containerWidth = containerEl.clientWidth || 1;
  const containerHeight = containerEl.clientHeight || 1;

  // 「画面1pxが現実世界で何メートルに相当するか」を、縦横それぞれ計算して平均する
  const metersPerPixelLat = (span.latitudeDelta * METERS_PER_DEGREE_LAT) / containerHeight;
  const metersPerPixelLng = (span.longitudeDelta * metersPerDegreeLng) / containerWidth;
  const metersPerPixel = (metersPerPixelLat + metersPerPixelLng) / 2;

  if (metersPerPixel <= 0) return 0;

  // 保証半径ぶんを直径のpx数に変換して返す
  const radiusPx = MIN_COVERAGE_RADIUS_METERS / metersPerPixel;
  return Math.round(radiusPx * 2);
}

// ============================================================
// 🔍【バグ修正 2026-07-18】superclusterに渡すズームレベルの計算
//
// 【何が間違っていたか】
// 以前は  Math.round(Math.log2(360 / span.longitudeDelta))  だけで
// 計算していたが、これは「画面の横幅が512pxのとき」にしか正しくない。
//
// superclusterの radius: 100 という設定は、「タイル座標系(横512px)上での
// 100px」という意味で解釈される。実際の画面幅(例:1200px)と合わせるには、
// 画面幅とタイル幅(512)の比を、ズームレベルに足し込む必要がある。
//
//   正しい式： log2(360 / 経度幅) + log2(画面幅 / 512)
//
// 【放置するとどうなっていたか】
// 画面幅1200pxの場合、第2項は約1.23。つまり実際より1.23ぶん低い
// ズームレベルをsuperclusterに渡していた。低いズーム＝粗いまとめ方
// なので、radius:100 が画面上では実効230px前後として効いてしまい、
// 半径230px以内のご近所がまるごと1つの霧に吸収されていた。
//
// これが「投稿してもその場に霧ができず、近くの霧に吸い込まれる」
// という症状の主犯。
//
// 【副作用】
// 渡すズームが正しく(＝高く)なるぶん、CLOUD_ZOOM_THRESHOLD(16)に
// 到達するタイミングも早まる。円のままでいてほしい範囲が霧に
// なってしまう場合は、CLOUD_ZOOM_THRESHOLDを17〜18に上げること。
// ============================================================
const SUPERCLUSTER_TILE_SIZE = 512;

function calcSuperclusterZoom(map: any, containerEl: HTMLDivElement | null): number {
  const span = map.region.span;
  const containerWidth = containerEl?.clientWidth || SUPERCLUSTER_TILE_SIZE;

  const rawZoom =
    Math.log2(360 / span.longitudeDelta) + Math.log2(containerWidth / SUPERCLUSTER_TILE_SIZE);

  return Math.max(0, Math.min(20, Math.round(rawZoom)));
}

// ============================================================
// 🖱 投稿位置を選んでいる間（selecting/dragging）に、地図上のどこかを
// タップした時の処理。逆ジオコーディングを行い、結果をonMapClickRef
// 経由で親コンポーネントに渡す。map本体の"single-tap"イベントから呼ぶ。
//
// ★2026-07-18 追加：投稿できない場所を弾く（A案）★
// route.ts が outOfService:true を返してきた場合（海外・太平洋など、
// 日本の住所として成立しない地点）は、onMapClickRefを呼ばずに中断する。
// ＝ ピンも立たず、フォームにも進まない。
//
// ★2026-07-18 変更：警告の出し方★
// 以前は alert() を使っていたが、ブラウザ標準の警告ダイアログは
// 「エラーが起きた」ように見えて体験がよくなかったため、
// onOutOfServiceRef 経由で親に知らせ、親側でズーム警告と同じ見た目の
// 案内を出す方式に変更した。
// ============================================================
async function performTapAction(
  lat: number,
  lng: number,
  onMapClickRef: { current: (lat: number, lng: number, geo?: any) => void },
  onOutOfServiceRef: { current: (() => void) | undefined },
  onCancelRef: { current: () => void }
) {
  // ============================================================
  // ★2026-07-19 体感速度の改善：先にピンを立て、住所は裏で取る
  //
  // 従来はYahoo逆ジオコーディングの返事を待ってからピンを立てていたため、
  // スマホ回線だとタップから1秒以上何も起きず、エラーに見えていた。
  // 現在は、タップした瞬間にまずピンを立て（体感ゼロ秒）、住所が届いたら
  // 後から差し込む。禁止エリア・海外だと判明した場合は、その時点で
  // ピンを取り下げて警告を出す。
  // ============================================================
  onMapClickRef.current(lat, lng); // ①まずピンを立てる（住所は空のまま）

  try {
    const res = await fetch(`/api/reverse-geocode?lat=${lat}&lon=${lng}`);
    const geoData = await res.json();

    // ②投稿できない場所（海外・海・禁止エリア）だった場合は、
    //   立てたピンを取り下げて警告を出す
    if (geoData.outOfService) {
      onCancelRef.current();
      onOutOfServiceRef.current?.();
      return;
    }

    if (geoData.error) return; // 住所が取れなかっただけなら、ピンはそのまま（手入力できる）

    // ③住所が届いたので、ピンの情報に差し込む
    onMapClickRef.current(lat, lng, geoData);
  } catch {
    // 通信失敗時はピンをそのまま残す（住所は手入力できる）
  }
}

// ============================================================
// 🖱 投稿位置を選んでいる間（selecting/dragging）は、既存の霧アノテーションが
// タップを吸収してしまい、下の地図のsingle-tapが発火しない問題への対策。
//
// ★2回のDOM操作(pointer-events)による対策は、いずれもMapKit内部の
// 再描画タイミングと競合し、うまく機能しなかった（タップ反応なし／
// 地図が斜めに動く、等の不具合が発生）。
// そのため、DOM要素を直接いじるのではなく、MapKit JSが公式に提供している
// Annotationの `enabled` プロパティを使う方式に変更した。
// DOM要素の生成タイミングに依存しないため、レンダリング競合が起きない。
// ============================================================
function applyAnnotationInteractivity(
  markersRef: { current: any[] },
  isSelectingRef: { current: boolean },
  reportPosRef: { current: { lat: number; lng: number } | null }
) {
  const disableTap = isSelectingRef.current || !!reportPosRef.current;
  markersRef.current.forEach((ann) => {
    if (ann) {
      // ★2026-07-19：復帰時は一律trueではなく、本来の値(__baseEnabled)に戻す。
      // 霧は常にfalse（タップ素通し）、円はtrue（タップで展開ズーム）。
      ann.enabled = disableTap ? false : (ann.__baseEnabled ?? true);
    }
  });
}

// ============================================================
// 🪳 投稿直後の確認ピン：吹き出しの中身を組み立てる（2026-07-18 追加）
//
// ★DBの項目を変えるときは、この関数だけ直せばよい★
// 予定では 日付 / 場所(住所) / 詳細(自由記述) の3つになるので、
// そのときは下の rows.push(...) の行を書き換えること。
//
// ★このデータはDBから読み直していない★
// 投稿フォームがメモリに持っている内容をそのまま表示しているだけなので、
// 他人には見えないし、ページを更新すれば消える。
// ============================================================
function buildJustPostedCallout(
  report: Report,
  onDismiss?: () => void,
  onDeleted?: () => void
) {
  const container = document.createElement("div");
  container.style.cssText =
    "background:#FFFFFF;border-radius:12px;padding:14px 16px;box-shadow:0 4px 16px rgba(0,0,0,0.18);min-width:220px;max-width:280px;text-align:left;";

  const title = document.createElement("p");
  title.textContent = "投稿しました";
  title.style.cssText =
    "margin:0 0 4px;font-size:14px;font-weight:700;color:#662510;letter-spacing:0.02em;";
  container.appendChild(title);

  const note = document.createElement("p");
  note.textContent = "この表示はあなたにだけ見えています。ページを閉じると霧に変わります。";
  note.style.cssText = "margin:0 0 10px;font-size:11px;color:#78716C;line-height:1.5;";
  container.appendChild(note);

  // ▼ 表示する項目。DB変更時はここを書き換える
  const rows: [string, string][] = [];
  if (report.occurred_on) rows.push(["目撃日", report.occurred_on]);
  if (report.address) rows.push(["場所", report.address]);
  if (report.detail) rows.push(["詳細", report.detail]);

  rows.forEach(([label, value]) => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;margin-bottom:4px;font-size:12px;line-height:1.6;";

    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    labelEl.style.cssText = "color:#78716C;flex-shrink:0;min-width:56px;";

    const valueEl = document.createElement("span");
    valueEl.textContent = value;
    valueEl.style.cssText = "color:#292524;font-weight:600;word-break:break-all;";

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    container.appendChild(row);
  });

  // ============================================================
  // 🗑「この投稿を取り消す」ボタン（2026-07-18 実装）
  //
  // 投稿時にAPIが発行した削除トークン(delete_token)を添えて
  // DELETE /api/reports/[id] を呼ぶ。トークンは誰も読み出せない
  // report_details側に保存されているため、本人（＝いまこの画面を
  // 見ている人）以外は照合できず、他人の投稿は消せない。
  //
  // ★誤タップ防止のため2段階式★
  // 1回目のクリックで文言が「もう一度押すと取り消します」に変わり、
  // 2回目のクリックで実際に削除する。ネイティブのconfirm()は
  // 見た目がエラー警告風なので使わない（outOfService警告と同じ方針）。
  // ============================================================
  if (report.delete_token && report.id) {
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "この投稿を取り消す";
    deleteBtn.style.cssText =
      "margin-top:10px;width:100%;background:transparent;color:#B3261E;border:1.5px solid #B3261E;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;";

    let armed = false; // 2段階確認の状態
    deleteBtn.onclick = async () => {
      if (!armed) {
        armed = true;
        deleteBtn.textContent = "本当に取り消す";
        deleteBtn.style.background = "#B3261E";
        deleteBtn.style.color = "#FFFFFF";
        return;
      }

      deleteBtn.disabled = true;
      deleteBtn.textContent = "取り消し中...";
      try {
        const res = await fetch(`/api/reports/${report.id}`, {
          method: "DELETE",
          headers: { "x-delete-token": report.delete_token! },
        });
        if (!res.ok) {
          deleteBtn.disabled = false;
          deleteBtn.textContent = "取り消しに失敗しました。もう一度押してください";
          return;
        }
        // 成功：親に通知（確認ピンを消す＋地図を再読込して霧を消す）
        if (onDeleted) onDeleted();
      } catch {
        deleteBtn.disabled = false;
        deleteBtn.textContent = "通信に失敗しました。もう一度押してください";
      }
    };
    container.appendChild(deleteBtn);
  }

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "完了";
  closeBtn.style.cssText =
    "margin-top:10px;width:100%;background:transparent;color:#662510;border:1.5px solid #662510;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;";
  closeBtn.onclick = () => {
    if (onDismiss) onDismiss();
  };
  container.appendChild(closeBtn);

  return container;
}

// マーカー描画メイン処理
// ヒートマップ表示：どれだけズームしても個別ピンは出さない。
// 1件だけの投稿も、必ず「件数1の雲」として表示する
//
// この関数はクラスタ木を構築しない（.load()を呼ばない）。
// clusterIndexRef.current にはすでに構築済みのSuperclusterインスタンスが
// 入っている前提で、bbox・zoomに応じた getClusters() の取り出しだけを行う。
// 木構築は reports が変わった時の useEffect 側の責務。
function renderMarkers(
  map: any,
  markersRef: { current: any[] },
  clusterIndexRef: { current: Supercluster | null },
  containerEl: HTMLDivElement | null
) {
  if (!clusterIndexRef.current) return;

  markersRef.current.forEach((m) => map.removeAnnotation(m));

  const span = map.region.span;
  const center = map.region.center;

  // ★2026-07-18：画面幅を考慮した正しいズーム計算に修正
  // （詳細は calcSuperclusterZoom のコメントを参照）
  const currentZoom = calcSuperclusterZoom(map, containerEl);

  // ============================================================
  // 🖼【④画面中央表示の範囲はここ】(2026-07-17 追加)
  //
  // 画面いっぱい(端から端まで)にクラスタを描画すると、地図の端ギリギリに
  // 見切れる形で表示されることがあり、見た目としてあまり望ましくなかった
  // ため、画面の外周(ロの字型の余白)にはあえて何も表示せず、中央の
  // INNER_VIEWPORT_RATIO分の範囲だけにクラスタが収まるようにする。
  //
  // 値を下げるほど、中央に表示される範囲が狭くなる(外周の余白が広がる)。
  // 1.0にすると画面いっぱい(=この機能を無効化した状態と同じ)になる。
  // ============================================================
  const INNER_VIEWPORT_RATIO = 0.6;

  const latMin = center.latitude - (span.latitudeDelta * INNER_VIEWPORT_RATIO) / 2;
  const latMax = center.latitude + (span.latitudeDelta * INNER_VIEWPORT_RATIO) / 2;
  const lngMin = center.longitude - (span.longitudeDelta * INNER_VIEWPORT_RATIO) / 2;
  const lngMax = center.longitude + (span.longitudeDelta * INNER_VIEWPORT_RATIO) / 2;

  const bbox: [number, number, number, number] = [lngMin, latMin, lngMax, latMax];
  const zoom = Math.min(currentZoom, MAX_CLUSTER_ZOOM);
  const clusters = clusterIndexRef.current.getClusters(bbox, zoom);

  const finalAnnotations = clusters.map((c: any) => {
    const [lng, lat] = c.geometry.coordinates;
    const isCluster = !!c.properties.cluster;
    const count = isCluster ? c.properties.point_count : 1;

    // ============================================================
    // ★2026-07-18 PostGIS対応：「数」の使い分け
    //
    // ・count（superclusterのpoint_count）
    //     ＝ このクラスタに何個の投稿がまとまっているか。
    //     円モードの数字表示・霧のサイズ(伸び分)には引き続きこちらを使う。
    //
    // ・colorCount（nearby_count由来。クラスタならメンバーの最大値）
    //     ＝ 半径120m以内の固定カウント。DB側で事前計算済み。
    //     ★霧の「色」はこちらで決める★
    //     ズームでクラスタが分裂・結合しても、各点の値は変わらないので、
    //     「ズームすると色が変わる」問題が解消される。
    //     （クラスタの間は最大値で塗るので、ズームインで色が
    //       薄くなることはあっても濃くなることはない）
    // ============================================================
    const colorCount = isCluster
      ? (c.properties.maxNearby ?? count)
      : (c.properties.report?.nearby_count ?? 1);

    // count===1（単独投稿）は、ズームレベルに関係なく常に雲にする。
    // count>=2 は従来通り、ズームレベルで円/雲を切り替える。
    const isCloudZoom = count === 1 || currentZoom >= CLOUD_ZOOM_THRESHOLD;

    // 雲の形・オフセットを安定させるためのseed。
    // ★注意：supercluster の cluster_id は、.load()で木を再構築するたびに
    // 内部的に振り直されることがあり、無関係な場所への新規投稿が原因で
    // 既存のクラスタのseedが変わってしまうバグの原因になっていた。
    // そのため、cluster_id ではなく、座標そのものから決定的に算出する。
    //
    // ★既知の限界（2026-07-18）★
    // superclusterのクラスタ座標は「所属する点の重心」なので、近くに
    // 新規投稿が1件加わると重心がわずかに動く → 座標が変わる →
    // seedも変わる → 霧の形とオフセットも変わる。
    // 「投稿したら近くの霧が動いた」ように見える一因はこれ。
    // 根本解決はPostGIS方式（固定半径カウント）への移行が必要。
    const seed = Math.abs(Math.round(lat * 1e6) * 1000003 + Math.round(lng * 1e6));

    // ★中心オフセット：実際の座標(lat, lng)から、seed固定でごくわずかにずらした
    // 座標(offsetLat, offsetLng)を、表示・当たり判定の基準にする
    const { deltaLat, deltaLng } = calcOffsetLatLng(seed, lat);
    const offsetLat = lat + deltaLat;
    const offsetLng = lng + deltaLng;
    const coordinate = new window.mapkit.Coordinate(offsetLat, offsetLng);

    const baseSize = calcCircleSize(count);
    const minCoverageSize = calcMinCoverageSizePx(map, containerEl);
    const CLOUD_PADDING_RATIO = 1.8; // createCloudIconUrl内のPADDING計算と連動(0.4*2+1=1.8)

    let displaySize: number;
    let icon: string;

    if (isCloudZoom) {
      // ============================================================
      // ☁️ 霧のサイズ計算【2026-07-18 修正】
      //
      // 【土台】floorSize
      //   ＝ 1投稿あたりの霧の大きさ。実質は minCoverageSize（＝
      //     MIN_COVERAGE_RADIUS_METERS を画面px数に換算したもの）が効く。
      //   ★霧を大きくしたいときは MIN_COVERAGE_RADIUS_METERS を上げる★
      //
      // 【伸び分】growth
      //   ＝ 件数が増えたぶんの上乗せ。1件のときは0px。
      //   ★MAX_CLOUD_DISPLAY_SIZE_PX は、この伸び分にだけ効かせる。
      //     土台は絶対に削らない ＝ 法的リスク対策の下限を守る。
      //
      // 【安全弁】HARD_MAX_CLOUD_PX
      //   ＝ 深いズームでCanvasが巨大化して重くなるのを防ぐだけ。
      //     通常は発動しない。
      //
      // 【修正前の何が問題だったか】
      //   Math.min(Math.max(natural, minCoverage) + growth, 220) と
      //   書かれており、土台ごと220pxに潰されていた。霧モードの
      //   全域で常に220px固定になっており、MIN_COVERAGE_RADIUS_METERS を
      //   いくら上げても見た目が1pxも変わらなかった。
      //   さらに実効の保証半径が46m前後まで縮んでいた（意図は120m）。
      // ============================================================
      const naturalDisplaySize = Math.round(baseSize * CLOUD_PADDING_RATIO);
      const floorSize = Math.max(naturalDisplaySize, minCoverageSize);

      const growth = calcCloudGrowthPx(count);
      displaySize = Math.max(
        floorSize,
        Math.min(floorSize + growth, MAX_CLOUD_DISPLAY_SIZE_PX)
      );

      displaySize = Math.min(displaySize, HARD_MAX_CLOUD_PX);

      // 表示サイズから逆算して、余白を除いた「核」のサイズを渡す。
      // これで生成される画像の解像度が displaySize とぴったり一致し、
      // 後から引き伸ばされることがなくなる
      const coreSize = Math.round(displaySize / CLOUD_PADDING_RATIO);
      icon = getCachedCloudIconUrl(count, colorCount, coreSize, seed);
    } else {
      displaySize = Math.min(Math.max(baseSize, minCoverageSize), MAX_CIRCLE_DISPLAY_SIZE_PX);
      // 円モードは余白なしで、そのままdisplaySizeの解像度で生成する
      icon = getCachedClusterIconUrl(count, displaySize);
    }

    const annotation = new window.mapkit.ImageAnnotation(coordinate, {
      url: { 1: icon },
      size: { width: displaySize, height: displaySize },
      anchorOffset: new DOMPoint(0, -displaySize / 2),
    });

    // ============================================================
    // ★2026-07-19 スマホ操作バグの根本修正：霧はタップ対象にしない
    //
    // ズームインすると霧は画面の大部分を覆う巨大な画像になるが、
    // タップに反応する設定のままだったため、
    //   ・指でなぞる → 霧が「タップされた」と誤解 → 勝手に展開ズーム
    //   ・ピンチ → 霧が指を吸収し、地図までジェスチャーが届かない
    // という誤動作が起きていた（「霧に触れるとバグる」symptomatic）。
    //
    // 霧(isCloudZoom)は enabled=false でタッチを地図に素通しさせる。
    // 円(🪳＋数字)は従来通りタップで展開ズームできる。
    // __baseEnabled は applyAnnotationInteractivity が投稿位置選択中の
    // 一時無効化から復帰するときの「本来の値」として参照する。
    // ============================================================
    (annotation as any).__baseEnabled = !isCloudZoom;
    annotation.enabled = !isCloudZoom;

    if (isCluster && !isCloudZoom) {
      annotation.addEventListener("select", () => {
        const expansionZoom = Math.min(
          clusterIndexRef.current!.getClusterExpansionZoom(c.properties.cluster_id),
          MAX_CLUSTER_ZOOM
        );
        const newSpanDeg = 360 / Math.pow(2, expansionZoom);
        map.setRegionAnimated(
          new window.mapkit.CoordinateRegion(
            new window.mapkit.Coordinate(offsetLat, offsetLng),
            new window.mapkit.CoordinateSpan(newSpanDeg, newSpanDeg)
          )
        );
      });
    }
    return annotation;
  });

  map.addAnnotations(finalAnnotations);
  markersRef.current = finalAnnotations;
}

const AppleMap = forwardRef<AppleMapHandle, AppleMapProps>(function AppleMap(
  {
    onMapClick,
    reportPos,
    isSelecting,
    onStartInput,
    onCancel,
    refreshTrigger,
    justPosted = null,
    onDismissJustPosted,
    onJustPostedDeleted,
    adminKey = null,
    onOutOfService,
  },
  ref
) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const reportMarkerRef = useRef<any>(null);
  const justPostedMarkerRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const clusterIndexRef = useRef<Supercluster | null>(null);
  const [reports, setReports] = useState<Report[]>([]);

  // ============================================================
  // 📱 スマホ判定（2026-07-19 追加）
  // 画面幅768px未満をスマホ扱いとし、凡例の位置・サイズや
  // ズーム上限などをPC/スマホで出し分けるのに使う。
  // ============================================================
  const [isMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );

  // ============================================================
  // 🎨 目撃件数の凡例（2026-07-19 PC/スマホ出し分け対応）
  // ★【凡例の位置・サイズを微調整したいときは、下の2つのセットを変える】★
  //   PC   ：右上に固定（従来の大きさに戻した）
  //   スマホ：左下（🍎リーガル表示の上）に固定・PCよりやや小さめ
  // font=文字サイズ / swatch=色見本の四角の大きさ / pad=箱の内側余白
  // ============================================================
  const LEGEND_PC = { top: 72, right: 16, font: 14, swatch: 18, pad: "12px 16px", line: 1.9 };
  const LEGEND_SP = { bottom: 36, left: 10, font: 13, swatch: 16, pad: "10px 14px", line: 1.8 };
  const [legendCollapsed, setLegendCollapsed] = useState(false);

  const isSelectingRef = useRef(isSelecting);
  const onMapClickRef = useRef(onMapClick);
  const reportPosRef = useRef(reportPos);
  const reportsRef = useRef<Report[]>([]);
  const onStartInputRef = useRef(onStartInput);
  const onCancelRef = useRef(onCancel);
  const onDismissJustPostedRef = useRef(onDismissJustPosted);
  const onJustPostedDeletedRef = useRef(onJustPostedDeleted);

  // ============================================================
  // 🔑 管理者モード：投稿ピンの表示と削除（2026-07-19 追加）
  //
  // 「霧の中のどの投稿を消せばいいか分からない」問題への回答。
  // 管理者だけ、投稿1件ずつの📍ピンが霧の上に表示され、タップすると
  // 投稿内容と削除ボタンが出る。地図上で直接サクサク消せる。
  //
  // ・ピンはズームがある程度深いときだけ表示（浅いと数が多すぎるため）
  // ・データは /api/admin/reports のbboxモードから取得。サーバーが
  //   x-admin-keyを検証するので、合言葉なしでは1件も取れない
  // ・削除するとfetchReports()を呼び直し、霧（nearby_count）も更新される
  // ============================================================
  const adminKeyRef = useRef<string | null | undefined>(adminKey);
  const adminPinsRef = useRef<any[]>([]);
  const renderAdminPinsRef = useRef<(map: any) => void>(() => {});

  const clearAdminPins = (map: any) => {
    adminPinsRef.current.forEach((a) => map.removeAnnotation(a));
    adminPinsRef.current = [];
  };

  // 管理者ピンの吹き出し（投稿内容＋2段階削除ボタン）
  const buildAdminPinCallout = (r: any, map: any, ann: any) => {
    const box = document.createElement("div");
    box.style.cssText =
      "background:#FFFFFF;border-radius:12px;padding:12px 14px;box-shadow:0 4px 16px rgba(0,0,0,0.18);min-width:210px;max-width:270px;text-align:left;";

    const title = document.createElement("p");
    title.textContent = `投稿 #${r.id}（管理者のみ表示）`;
    title.style.cssText = "margin:0 0 8px;font-size:13px;font-weight:700;color:#662510;";
    box.appendChild(title);

    // ※ユーザー入力(住所・詳細)を扱うため、innerHTMLではなくtextContentで
    //   組み立てる（スクリプト混入＝XSS対策）
    const rows: [string, string][] = [
      ["投稿日時", new Date(r.created_at).toLocaleString("ja-JP")],
      ["目撃日", r.occurred_on ?? "-"],
      ["住所", r.report_details?.address ?? "-"],
      ["詳細", r.report_details?.detail ?? "-"],
      ["近隣件数", String(r.nearby_count ?? "-")],
    ];
    rows.forEach(([label, value]) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;margin-bottom:4px;font-size:12px;line-height:1.6;";
      const l = document.createElement("span");
      l.textContent = label;
      l.style.cssText = "color:#78716C;flex-shrink:0;min-width:56px;";
      const v = document.createElement("span");
      v.textContent = value;
      v.style.cssText = "color:#292524;word-break:break-all;";
      row.appendChild(l);
      row.appendChild(v);
      box.appendChild(row);
    });


    const delBtn = document.createElement("button");
    delBtn.textContent = "この投稿を削除";
    delBtn.style.cssText =
      "margin-top:8px;width:100%;background:transparent;color:#B3261E;border:1.5px solid #B3261E;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;";
    let armed = false;
    delBtn.onclick = async () => {
      if (!armed) {
        armed = true;
        delBtn.textContent = "本当に削除";
        delBtn.style.background = "#B3261E";
        delBtn.style.color = "#FFFFFF";
        return;
      }
      delBtn.disabled = true;
      delBtn.textContent = "削除中...";
      try {
        const res = await fetch("/api/admin/reports", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": adminKeyRef.current ?? "",
          },
          body: JSON.stringify({ id: r.id }),
        });
        if (!res.ok) {
          delBtn.disabled = false;
          delBtn.textContent = "失敗しました。もう一度押してください";
          return;
        }
        map.removeAnnotation(ann);
        adminPinsRef.current = adminPinsRef.current.filter((a) => a !== ann);
        // 霧（nearby_count）を最新に描き直す
        fetchReports();
      } catch {
        delBtn.disabled = false;
        delBtn.textContent = "通信失敗。もう一度押してください";
      }
    };
    box.appendChild(delBtn);
    return box;
  };

  const renderAdminPins = async (map: any) => {
    const key = adminKeyRef.current;
    if (!key || !map) return;

    const span = map.region.span;
    const center = map.region.center;

    // ズームが浅い（広域表示）ときはピンを出さない。
    // 0.08度 ≒ 約9km四方。これより広いと件数が多すぎて重くなるため。
    if (span.latitudeDelta > 0.08) {
      clearAdminPins(map);
      return;
    }

    const qs =
      `latMin=${center.latitude - span.latitudeDelta / 2}` +
      `&latMax=${center.latitude + span.latitudeDelta / 2}` +
      `&lngMin=${center.longitude - span.longitudeDelta / 2}` +
      `&lngMax=${center.longitude + span.longitudeDelta / 2}`;

    try {
      const res = await fetch(`/api/admin/reports?${qs}`, {
        headers: { "x-admin-key": key },
      });
      if (!res.ok) return; // 合言葉が無効なら何も表示しない（サーバーが門番）
      const json = await res.json();

      clearAdminPins(map);
      (json.reports ?? []).forEach((r: any) => {
        const ann = new window.mapkit.Annotation(
          new window.mapkit.Coordinate(r.lat, r.lng),
          () => {
            const div = document.createElement("div");
            div.style.display = "inline-block";
            div.style.lineHeight = "1";
            div.style.fontSize = "24px";
            div.style.cursor = "pointer";
            div.style.filter = "drop-shadow(0 1px 2px rgba(0,0,0,0.4))";
            div.textContent = "📍";
            return div;
          },
          { calloutEnabled: true, calloutOffset: new DOMPoint(0, 6) }
        );
        ann.callout = {
          calloutElementForAnnotation: () => buildAdminPinCallout(r, map, ann),
        };
        map.addAnnotation(ann);
        adminPinsRef.current.push(ann);
      });
    } catch {
      /* 通信失敗時は何もしない（次のパン・ズームで再試行される） */
    }
  };
  renderAdminPinsRef.current = renderAdminPins;

  useEffect(() => {
    adminKeyRef.current = adminKey;
    if (mapRef.current) renderAdminPinsRef.current(mapRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey]);
  const onOutOfServiceRef = useRef(onOutOfService);

  // ============================================================
  // 🪳 ゴキブリアイコン画像のロード状態（2026-07-17 追加）
  // 画像ロード完了時にこの値を更新し、以下のuseEffectで
  // アイコンキャッシュをクリア＆再描画をトリガーする。
  // ============================================================
  const [roachImageReady, setRoachImageReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadRoachImage()
      .then(() => {
        if (cancelled) return;
        // 画像ロード前に絵文字版でキャッシュ済みのアイコンが残っている可能性があるため、
        // 一度クリアしてから画像版で描き直させる
        clusterIconCache.clear();
        setRoachImageReady(true);
      })
      .catch((err) => {
        console.error("🪳アイコン画像のロードに失敗しました。絵文字表示にフォールバックします:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    isSelectingRef.current = isSelecting;
    onMapClickRef.current = onMapClick;
    if (mapContainerRef.current) {
      mapContainerRef.current.style.cursor = isSelecting ? "crosshair" : "";
    }
  }, [isSelecting, onMapClick]);

  useEffect(() => {
    reportPosRef.current = reportPos;
  }, [reportPos]);

  useEffect(() => {
    onStartInputRef.current = onStartInput;
    onCancelRef.current = onCancel;
    onDismissJustPostedRef.current = onDismissJustPosted;
    onJustPostedDeletedRef.current = onJustPostedDeleted;
    onOutOfServiceRef.current = onOutOfService;
  }, [onStartInput, onCancel, onDismissJustPosted, onJustPostedDeleted, onOutOfService]);

  useImperativeHandle(ref, () => ({
    isZoomedInEnough: () => {
      if (!mapRef.current) return false;
      return mapRef.current.region.span.latitudeDelta <= ZOOM_THRESHOLD;
    },
  }));

  const fetchReports = async () => {
    const PAGE_SIZE = 1000;

    // ============================================================
    // ★2026-07-19 高速化：ページを「順番に」ではなく「一斉に」取る
    //
    // 従来は1000件ずつ順番に取得していたため、3.5万件なら35回の通信が
    // 数珠つなぎになり、全部届くまでゴキブリが表示されなかった
    // （初回表示が遅い最大の原因）。
    // 先に総件数だけ聞き、必要なページ数ぶんのリクエストを同時に投げる
    // ことで、通信時間が「35往復分」から「ほぼ1往復分」になる。
    //
    // 取得カラムを id, lat, lng, nearby_count に絞る方針は従来通り
    // （地図に不要な情報をブラウザに配らない＋転送量削減）。
    // ============================================================
    const { count, error: countError } = await supabase
      .from("reports")
      .select("id", { count: "exact", head: true });

    if (countError) {
      console.error("reports件数取得エラー:", countError);
      return;
    }
    const total = count ?? 0;
    if (total === 0) {
      setReports([]);
      return;
    }

    const pageCount = Math.ceil(total / PAGE_SIZE);
    const results = await Promise.all(
      Array.from({ length: pageCount }, (_, i) =>
        supabase
          .from("reports")
          .select("id, lat, lng, nearby_count")
          .order("id", { ascending: true })
          .range(i * PAGE_SIZE, (i + 1) * PAGE_SIZE - 1)
      )
    );

    const allReports: any[] = [];
    results.forEach((r, i) => {
      if (r.error) {
        console.error(`reports取得エラー(ページ${i + 1}):`, r.error);
      } else if (r.data) {
        allReports.push(...r.data);
      }
    });
    setReports(allReports);
  };

  useEffect(() => {
    fetchReports();
  }, [refreshTrigger]);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    let cancelled = false;
    let initialized = false;

    const setupMap = () => {
      if (initialized || !mapContainerRef.current) return;
      initialized = true;

      if (!(window as any).__mapkitInitialized) {
        window.mapkit.init({
          authorizationCallback: (done: (token: string) => void) => {
            fetch("/api/mapkit-token").then((r) => r.text()).then(done);
          },
        });
        (window as any).__mapkitInitialized = true;
      }

      const map = new window.mapkit.Map(mapContainerRef.current, {
        region: new window.mapkit.CoordinateRegion(
          new window.mapkit.Coordinate(36.5, 138.5),
          new window.mapkit.CoordinateSpan(20, 24)
        ),
        showsZoomControl: false,
        showsCompass: "hidden",
        isRotationEnabled: false,
        // ★2026-07-19 スマホ対応：右上の「位置情報」「航空写真」ボタンを非表示に
        showsUserLocationControl: false,
        showsMapTypeControl: false,
      });

      mapRef.current = map;

      // ============================================================
      // 🛡【②ズームの深さの上限はここ】法的リスク対策
      //
      // MapKit JSのcameraZoomRangeで「カメラが地図中心にどこまで近づけるか」を
      // メートル単位で制限する。
      //   数値を大きくする → ズームできる限界が浅くなる（＝建物を特定しにくい）
      //   数値を小さくする → より深くズームインできる
      //
      // ★2026-07-19：PC/スマホで別の値を持てるようにした。
      //   スマホは画面が小さく、同じ制限だと窮屈に感じるため、
      //   PCより深くズームできるようにしてある。
      //   ※どこまで深くしても、霧が個別ピンに分解されることはない
      //     （count===1でも常に霧。最低保証半径120mも維持される）
      //
      // ★霧が「大きすぎる」と感じたときは、MIN_COVERAGE_RADIUS_METERS を
      //   下げるのではなく、こちらを上げること。
      // ============================================================
      const MIN_CAMERA_DISTANCE_METERS_PC = 200;
      const MIN_CAMERA_DISTANCE_METERS_SP = 50; // スマホ用。小さいほど深く寄れる（2026-07-20: 80→50）
      const isMobileInit = typeof window !== "undefined" && window.innerWidth < 768;
      map.cameraZoomRange = new window.mapkit.CameraZoomRange(
        isMobileInit ? MIN_CAMERA_DISTANCE_METERS_SP : MIN_CAMERA_DISTANCE_METERS_PC
      );


      map.addEventListener("region-change-end", () => {
        renderMarkers(map, markersRef, clusterIndexRef, mapContainerRef.current);
        applyAnnotationInteractivity(markersRef, isSelectingRef, reportPosRef);
        renderAdminPinsRef.current(map); // 管理者モード時のみ実際に描画される
      });

      renderMarkers(map, markersRef, clusterIndexRef, mapContainerRef.current);
      applyAnnotationInteractivity(markersRef, isSelectingRef, reportPosRef);
      renderAdminPinsRef.current(map);

      map.addEventListener("single-tap", async (event: any) => {
        if (!isSelectingRef.current && !reportPosRef.current) return;

        const coordinate = map.convertPointOnPageToCoordinate(event.pointOnPage);
        const lat = coordinate.latitude;
        const lng = coordinate.longitude;

        await performTapAction(lat, lng, onMapClickRef, onOutOfServiceRef, onCancelRef);
      });
    };

    const waitForMapkit = () => {
      if (window.mapkit) {
        setupMap();
      } else if (!cancelled) {
        setTimeout(waitForMapkit, 100);
      }
    };
    waitForMapkit();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
  }, []);

  // reportsが変わった時だけ、ここでクラスタ木を1回構築する。
  // パン・ズーム(region-change-end)では、この木を再構築せず取り出すだけにする。
  useEffect(() => {
    reportsRef.current = reports;

    // ============================================================
    // ★2026-07-18 PostGIS対応：map/reduce を追加
    //
    // 各点が持つ nearby_count（DB側で事前計算した「半径120m以内の件数」）を、
    // クラスタにまとめられても失わないように持ち回る。
    //
    // ・map   ：各点 → { maxNearby: その点のnearby_count }
    // ・reduce：クラスタ → maxNearby = メンバー全員の最大値
    //
    // 【なぜ最大値か（本人の設計判断・2026-07-18）】
    // 危険度マップは「最悪値」で塗るのが定石。安全に見えて実は危険、が
    // 一番まずい。さらに最大値なら「ズームインすると色が薄くなることは
    // あっても濃くなることはない」という単調性が保証され、
    // 「ズームインで件数が減るのは自然、増えるのは不自然」という
    // 直感と一致する。
    // ============================================================
    clusterIndexRef.current = new Supercluster({
      radius: 100,
      maxZoom: MAX_CLUSTER_ZOOM,
      map: (props: any) => ({ maxNearby: props.report?.nearby_count ?? 1 }),
      reduce: (accumulated: any, props: any) => {
        accumulated.maxNearby = Math.max(accumulated.maxNearby, props.maxNearby);
      },
    });
    clusterIndexRef.current.load(
      reports.map((r) => ({
        type: "Feature",
        properties: { report: r },
        geometry: { type: "Point", coordinates: [r.lng, r.lat] },
      })) as any
    );

    if (!mapRef.current) return;
    renderMarkers(mapRef.current, markersRef, clusterIndexRef, mapContainerRef.current);
    applyAnnotationInteractivity(markersRef, isSelectingRef, reportPosRef);
  }, [reports]);

  // isSelecting・reportPosが変化した瞬間にも、既存の霧アノテーションの
  // タップ吸収状態を即座に切り替える（renderMarkersの再実行を待たない）
  useEffect(() => {
    applyAnnotationInteractivity(markersRef, isSelectingRef, reportPosRef);
  }, [isSelecting, reportPos]);

  // 🪳画像のロードが完了したタイミングで、既に絵文字版で描画済みの
  // マーカーを画像版に描き直す（clusterIconCacheは上のuseEffectで既にクリア済み）
  useEffect(() => {
    if (!roachImageReady || !mapRef.current) return;
    renderMarkers(mapRef.current, markersRef, clusterIndexRef, mapContainerRef.current);
    applyAnnotationInteractivity(markersRef, isSelectingRef, reportPosRef);
  }, [roachImageReady]);

  // ============================================================
  // 🪳 投稿直後の確認ピン（2026-07-18 追加）
  //
  // justPosted に値が入っている間だけ、その場所にゴキブリを立てて
  // 投稿内容を吹き出しで表示する。
  //
  // ★これはReactのstateなので、ページを更新・離脱すれば自動的に消える。
  //   その後は通常通り霧だけが残る。DBには何も保存していない。
  // ============================================================
  useEffect(() => {
    const currentMap = mapRef.current;
    if (!currentMap) return;

    // 既存の確認ピンがあれば消す
    if (justPostedMarkerRef.current) {
      currentMap.removeAnnotation(justPostedMarkerRef.current);
      justPostedMarkerRef.current = null;
    }

    if (!justPosted) return;

    const coordinate = new window.mapkit.Coordinate(justPosted.lat, justPosted.lng);

    const annotation = new window.mapkit.Annotation(
      coordinate,
      () => {
        const div = document.createElement("div");
        // ★アンカー位置ズレの修正：display:blockのままだと、余白を含めた
        // 大きな箱を基準にMapKitがアンカー計算してしまい、実際の座標と
        // 見た目の位置がズレる。inline-block化して箱を固定する。
        div.style.display = "inline-block";
        div.style.lineHeight = "1";
        div.style.cursor = "pointer";

        if (roachImageEl) {
          const img = document.createElement("img");
          img.src = ROACH_ICON_URL;
          img.style.width = "40px";
          img.style.height = "auto";
          img.style.display = "block";
          // 霧の上に立つので、白い縁取りで浮かせて見やすくする
          img.style.filter = "drop-shadow(0 0 2px #FFFFFF) drop-shadow(0 2px 4px rgba(0,0,0,0.35))";
          div.appendChild(img);
        } else {
          // 画像未ロード時は絵文字にフォールバック（円モードと同じ方針）
          div.style.fontSize = "32px";
          div.textContent = "🪳";
        }

        return div;
      },
      {
        draggable: false,
        calloutEnabled: true,
        calloutOffset: new DOMPoint(0, 8),
      }
    );

    annotation.callout = {
      calloutElementForAnnotation: () =>
        buildJustPostedCallout(
          justPosted,
          () => {
            if (onDismissJustPostedRef.current) onDismissJustPostedRef.current();
          },
          () => {
            if (onJustPostedDeletedRef.current) onJustPostedDeletedRef.current();
          }
        ),
    };

    currentMap.addAnnotation(annotation);
    // 吹き出しを最初から開いた状態にする（投稿できたことが一目で分かるように）
    currentMap.selectedAnnotation = annotation;
    justPostedMarkerRef.current = annotation;
  }, [justPosted, roachImageReady]);

  // ゴキブリピン（報告用ピン）のドラッグ・表示処理
  useEffect(() => {
    const currentMap = mapRef.current;
    if (!currentMap) return;

    if (reportMarkerRef.current) {
      currentMap.removeAnnotation(reportMarkerRef.current);
      reportMarkerRef.current = null;
    }

    if (reportPos) {
      currentMap.isZoomEnabled = false;
      const coordinate = new window.mapkit.Coordinate(reportPos.lat, reportPos.lng);

      const annotation = new window.mapkit.Annotation(
        coordinate,
        () => {
          const div = document.createElement("div");
          // ★【位置選択中の🪳の大きさはここ】(2026-07-19: 22→30に拡大)
          div.style.fontSize = "30px";
          // ★アンカー位置ズレの修正：display:blockのままだと、余白を含めた
          // 大きな箱を基準にMapKitがアンカー計算してしまい、実際のタップ位置と
          // 絵文字の見た目の位置がズレる。inline-block化し、絵文字ぴったりの
          // 箱に固定することで、タップした座標＝絵文字の中心になるようにする。
          div.style.display = "inline-block";
          div.style.lineHeight = "1";
          div.style.cursor = "grab";
          div.style.touchAction = "none";
          div.textContent = "🪳";

          let startX = 0;
          let startY = 0;
          let isDragging = false;
          const DRAG_THRESHOLD = 6;

          const onPointerMove = (e: PointerEvent) => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            if (!isDragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
              isDragging = true;
              div.style.cursor = "grabbing";
              currentMap.isScrollEnabled = false;
            }

            if (isDragging) {
              try {
                const domPoint = new DOMPoint(e.pageX, e.pageY);
                const newCoordinate = currentMap.convertPointOnPageToCoordinate(domPoint);
                annotation.coordinate = newCoordinate;
              } catch (err) {
                console.error("ピン移動時の座標変換に失敗しました:", err);
              }
            }
          };

          const onPointerUp = () => {
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
            div.style.cursor = "grab";
            currentMap.isScrollEnabled = true;

            if (isDragging) {
              if (reportPosRef.current) {
                reportPosRef.current.lat = annotation.coordinate.latitude;
                reportPosRef.current.lng = annotation.coordinate.longitude;
              }
            }
            isDragging = false;
          };

          div.addEventListener("pointerdown", (e: PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();
            startX = e.clientX;
            startY = e.clientY;
            window.addEventListener("pointermove", onPointerMove);
            window.addEventListener("pointerup", onPointerUp);
          });

          return div;
        },
        {
          draggable: false,
          calloutEnabled: true,
          // ★2026-07-19：吹き出しを🪳の真上・中央に出す（以前の(-10.5,17)は
          //   横ズレの原因で、🪳がボタンの間に挟まって見えていた）
          calloutOffset: new DOMPoint(0, 12),
        }
      );

      annotation.callout = {
        calloutElementForAnnotation: () => {
          // ============================================================
          // ★2026-07-19 スマホ対応：吹き出しを白箱＋しっぽ付きに変更
          // 透明のまま地図に重なると読みにくかったため、漫画の吹き出しの
          // ように白い箱で囲い、下辺中央から🪳へ向かう三角のしっぽを付けた。
          // ============================================================
          const container = document.createElement("div");
          container.style.cssText =
            "position:relative;background:#FFFFFF;border-radius:12px;padding:12px 14px;box-shadow:0 4px 16px rgba(0,0,0,0.18);text-align:center;min-width:210px;";

          // 🪳へ向かう三角のしっぽ
          const tail = document.createElement("div");
          tail.style.cssText =
            "position:absolute;left:50%;bottom:-8px;transform:translateX(-50%);width:0;height:0;" +
            "border-left:8px solid transparent;border-right:8px solid transparent;border-top:8px solid #FFFFFF;";
          container.appendChild(tail);

          const msg = document.createElement("p");
          msg.textContent = "ドラッグして位置を調整してください";
          msg.style.cssText =
            "margin:0 0 12px;font-size:13px;color:#292524;cursor:grab;touch-action:none;" +
            // ★iOS Safari対策：user-selectだけでは長押しの選択・コピーが
            //   出るため、-webkit-user-select と -webkit-touch-callout も
            //   明示的に切る（これでドラッグ中に文字が選択されなくなる）
            "user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;";

          // ============================================================
          // ★2026-07-20：この白箱(メッセージ部分)をドラッグしてもピンを
          // 動かせるようにする。🪳本体は親指で隠れて掴みにくいため、
          // 見えている白箱でも操作できると調整しやすい、という要望対応。
          // ボタン(キャンセル/入力)はドラッグ対象にしない(誤操作防止)。
          // ============================================================
          {
            let bStartX = 0, bStartY = 0, bDragging = false;
            const B_THRESHOLD = 6;
            const bMove = (e: PointerEvent) => {
              const dx = e.clientX - bStartX;
              const dy = e.clientY - bStartY;
              if (!bDragging && Math.hypot(dx, dy) > B_THRESHOLD) {
                bDragging = true;
                msg.style.cursor = "grabbing";
                currentMap.isScrollEnabled = false;
              }
              if (bDragging) {
                try {
                  // 白箱は🪳の上に出ているので、カーソル位置そのままだと
                  // ピンが指のかなり上に来てしまう。見た目の自然さのため、
                  // カーソルの少し下(40px)をピン位置にする。
                  const domPoint = new DOMPoint(e.pageX, e.pageY + 40);
                  annotation.coordinate = currentMap.convertPointOnPageToCoordinate(domPoint);
                } catch (err) {
                  console.error("白箱ドラッグ時の座標変換に失敗:", err);
                }
              }
            };
            const bUp = () => {
              window.removeEventListener("pointermove", bMove);
              window.removeEventListener("pointerup", bUp);
              msg.style.cursor = "grab";
              currentMap.isScrollEnabled = true;
              if (bDragging && reportPosRef.current) {
                reportPosRef.current.lat = annotation.coordinate.latitude;
                reportPosRef.current.lng = annotation.coordinate.longitude;
              }
              bDragging = false;
            };
            msg.addEventListener("pointerdown", (e: PointerEvent) => {
              e.preventDefault();
              e.stopPropagation();
              bStartX = e.clientX;
              bStartY = e.clientY;
              window.addEventListener("pointermove", bMove);
              window.addEventListener("pointerup", bUp);
            });
          }
          container.appendChild(msg);

          const cancelBtn = document.createElement("button");
          cancelBtn.textContent = "キャンセル";
          cancelBtn.style.cssText =
            "background:transparent;color:#662510;border:1.5px solid #662510;padding:8px 14px;border-radius:8px;cursor:pointer;margin-right:6px;font-size:13px;font-weight:600;";
          cancelBtn.onclick = () => onCancelRef.current();

          const inputBtn = document.createElement("button");
          inputBtn.textContent = "目撃情報を入力";
          inputBtn.style.cssText =
            "background:#662510;color:white;border:none;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;";
          inputBtn.onclick = () => {
            onStartInputRef.current(annotation.coordinate.latitude, annotation.coordinate.longitude);
          };

          const btnRow = document.createElement("div");
          btnRow.appendChild(cancelBtn);
          btnRow.appendChild(inputBtn);
          container.appendChild(btnRow);

          return container;
        },
      };

      currentMap.addAnnotation(annotation);
      currentMap.selectedAnnotation = annotation;
      reportMarkerRef.current = annotation;
    } else {
      currentMap.isZoomEnabled = true;
    }
  }, [reportPos]);

  const handleSearch = (
    lat: number,
    lng: number,
    boundingBox?: [string, string, string, string]
  ) => {
    if (!mapRef.current) return;

    let span;
    if (boundingBox) {
      const [south, north, west, east] = boundingBox.map(Number);
      const latDelta = Math.min(Math.max((north - south) * 1.3, 0.01), 3);
      const lngDelta = Math.min(Math.max((east - west) * 1.3, 0.01), 3);
      span = new window.mapkit.CoordinateSpan(latDelta, lngDelta);
    } else {
      span = new window.mapkit.CoordinateSpan(0.02, 0.02);
    }

    mapRef.current.setRegionAnimated(
      new window.mapkit.CoordinateRegion(new window.mapkit.Coordinate(lat, lng), span)
    );
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <SearchBar onSearch={handleSearch} />

      {/*
        🎨 目撃件数の凡例（PC=右上・従来サイズ／スマホ=左下・やや小さめ）
        位置・サイズの微調整は、コンポーネント上部の LEGEND_PC / LEGEND_SP で行う。
      */}
      <div
        style={{
          position: "absolute",
          ...(isMobile
            ? { bottom: LEGEND_SP.bottom, left: LEGEND_SP.left }
            : { top: LEGEND_PC.top, right: LEGEND_PC.right }),
          background: "white",
          borderRadius: 8,
          padding: isMobile ? LEGEND_SP.pad : LEGEND_PC.pad,
          boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
          fontSize: isMobile ? LEGEND_SP.font : LEGEND_PC.font,
          color: "#292524",
          zIndex: 10,
          lineHeight: isMobile ? LEGEND_SP.line : LEGEND_PC.line,
          userSelect: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: legendCollapsed ? 0 : 4,
          }}
        >
          <span
            style={{
              fontSize: (isMobile ? LEGEND_SP.font : LEGEND_PC.font) - 2,
              color: "#78716C",
              fontWeight: 700,
            }}
          >
            目撃件数
          </span>
          <button
            type="button"
            onClick={() => setLegendCollapsed((v) => !v)}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: isMobile ? LEGEND_SP.font : LEGEND_PC.font,
              color: "#78716C",
              padding: 0,
              lineHeight: 1,
            }}
            aria-label={legendCollapsed ? "凡例を開く" : "凡例を閉じる"}
          >
            {legendCollapsed ? "▸" : "▾"}
          </button>
        </div>

        {!legendCollapsed &&
          COUNT_COLOR_BUCKETS.map((bucket) => (
            <div key={bucket.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  display: "inline-block",
                  width: isMobile ? LEGEND_SP.swatch : LEGEND_PC.swatch,
                  height: isMobile ? LEGEND_SP.swatch : LEGEND_PC.swatch,
                  borderRadius: 3,
                  background: `rgb(${bucket.rgb})`,
                  border: "1px solid rgba(0,0,0,0.15)",
                  flexShrink: 0,
                }}
              />
              <span>{bucket.label}</span>
            </div>
          ))}
      </div>

      <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
});

export default AppleMap;
