"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
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
  /** 🗺 登録済みエリアを線で表示する（管理画面の描画地図で使う） */
  showAreas?: boolean;
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
// ★2026-07-17:🪳アイコン化に伴い、ズームイン時に大きくなりすぎるとの
// フィードバックを受けて140→100に下げた
// ★2026-07-29：霧に切り替わる直前のアイコンがまだ大きいとの指摘で
//   100→80に下げた。さらに小さくしたい場合はこの数字を下げる。
//   （ズームインすると、この上限に張り付いた大きさで頭打ちになる）
// ============================================================
const MAX_CIRCLE_DISPLAY_SIZE_PX = 80;

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
// ★2026-07-26：使い方ガイドの凡例図（HeaderMenu.tsx の
//   GUIDE_LEGEND_COLORS）にも同じ色・ラベルを書き写してある。
//   ここを変更したら、必ずそちらも変更すること。
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
const CLUSTER_CACHE_MAX = 150;
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
const OFFSET_MAX_METERS = 5;

// ============================================================
// 🌫️ 霧調整エリア（2026-07-22 追加）
//
// 【目的】削除依頼のあった建物に、隣家などの霧がかからないようにする。
// このエリアに入った投稿は、霧を「建物と反対方向へずらし」「小さく」描く。
// 投稿データ自体は一切変えない（描き方だけを変える）。
//
// 【なぜブラウザ側で判定するか】
// 投稿は数千件になりうるが、エリアは数十個程度。投稿ごとにDBへ
// 問い合わせると重いので、エリアの形（多角形）をまとめて受け取り、
// ブラウザ内で「点がエリアの中か」を判定する。
// さらに、まず外接矩形(bbox)で弾くので、ほとんどの投稿は一瞬で判定が済む。
//
// 【調整の効かせ方】
//  ・方向：エリアに重なる投稿禁止エリア（建物）の中心から見て、投稿が
//          外側へ逃げる向き（＝建物中心→投稿 の向き）。角なら斜めになる。
//  ・距離：霧の半径ぶん外へずらす（＝霧の内側の端が、ほぼ投稿地点に来る）。
//          これに margin_m を足し引きして微調整する。
//  ・大きさ：size_scale 倍に縮める（0.7〜0.8推奨）。
// ============================================================
type FogAdjustArea = {
  id: number;
  name: string;
  size_scale: number;
  margin_m: number;
  center_lat: number; // 「外向き」の基準点（建物の中心）
  center_lng: number;
  rings: { lat: number; lng: number }[][]; // 多角形の頂点（外周＋穴）
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
};

let fogAdjustAreas: FogAdjustArea[] = [];

// GeoJSONの座標配列から、判定用の形とbboxを作る
function buildFogArea(row: any): FogAdjustArea | null {
  try {
    const g = row.geojson;
    if (!g) return null;
    // Polygon（[[ [lng,lat], ... ]]）と MultiPolygon の両方に対応
    const polys: any[] =
      g.type === "MultiPolygon" ? g.coordinates.flat(1) : g.coordinates;
    const rings = polys.map((ring: any[]) =>
      ring.map((c: number[]) => ({ lng: c[0], lat: c[1] }))
    );
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    rings.forEach((r) =>
      r.forEach((p) => {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lng < minLng) minLng = p.lng;
        if (p.lng > maxLng) maxLng = p.lng;
      })
    );
    return {
      id: row.id,
      name: row.name,
      size_scale: Number(row.size_scale ?? 0.75),
      margin_m: Number(row.margin_m ?? 0),
      center_lat: Number(row.center_lat),
      center_lng: Number(row.center_lng),
      rings,
      bbox: { minLat, maxLat, minLng, maxLng },
    };
  } catch {
    return null;
  }
}

// 点が多角形の中にあるか（レイキャスティング法）
function pointInRing(lat: number, lng: number, ring: { lat: number; lng: number }[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].lat, xi = ring[i].lng;
    const yj = ring[j].lat, xj = ring[j].lng;
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// 指定地点が入っている調整エリアを返す（無ければnull）
function findFogAdjustArea(lat: number, lng: number): FogAdjustArea | null {
  for (const a of fogAdjustAreas) {
    // まず外接矩形で高速に弾く
    if (lat < a.bbox.minLat || lat > a.bbox.maxLat) continue;
    if (lng < a.bbox.minLng || lng > a.bbox.maxLng) continue;
    // 外周に入っていれば採用（穴の考慮は省略：運用上「回」の字の外周で足りる）
    if (a.rings.length > 0 && pointInRing(lat, lng, a.rings[0])) return a;
  }
  return null;
}

// 調整エリアを「今見えている範囲ぶんだけ」サーバーから読み込む。
// ★将来エリアが1万件規模になっても耐えるための設計：
//   全件を持たず、地図に映っている範囲だけを取得する。
//   同じ範囲を何度も取りに行かないよう、直前に取得した範囲を覚えておき、
//   その中に収まっているうちは再取得しない。
let fogAreaFetchedBounds: {
  minLat: number; maxLat: number; minLng: number; maxLng: number;
} | null = null;
let fogAreaFetching = false;

async function loadFogAdjustAreas(map: any): Promise<boolean> {
  if (fogAreaFetching) return false;
  try {
    const span = map.region.span;
    const c = map.region.center;
    // 画面より少し広めに取る（少しパンしても再取得しなくて済むように）
    const padLat = span.latitudeDelta * 0.75;
    const padLng = span.longitudeDelta * 0.75;
    const b = {
      minLat: c.latitude - padLat,
      maxLat: c.latitude + padLat,
      minLng: c.longitude - padLng,
      maxLng: c.longitude + padLng,
    };

    // 直前に取得した範囲に、今の表示範囲が収まっているなら再取得しない
    const cur = fogAreaFetchedBounds;
    const viewMinLat = c.latitude - span.latitudeDelta / 2;
    const viewMaxLat = c.latitude + span.latitudeDelta / 2;
    const viewMinLng = c.longitude - span.longitudeDelta / 2;
    const viewMaxLng = c.longitude + span.longitudeDelta / 2;
    if (
      cur &&
      viewMinLat >= cur.minLat && viewMaxLat <= cur.maxLat &&
      viewMinLng >= cur.minLng && viewMaxLng <= cur.maxLng
    ) {
      return false; // 変化なし
    }

    fogAreaFetching = true;
    const q = `?minLat=${b.minLat}&minLng=${b.minLng}&maxLat=${b.maxLat}&maxLng=${b.maxLng}`;
    const res = await fetch("/api/admin/fog-areas" + q);
    if (!res.ok) return false;
    const json = await res.json();
    fogAdjustAreas = (json.areas ?? [])
      .map(buildFogArea)
      .filter((a: FogAdjustArea | null): a is FogAdjustArea => a !== null);
    fogAreaFetchedBounds = b;
    return true; // 中身が更新された
  } catch {
    return false; // 取得失敗時は調整なしで通常表示
  } finally {
    fogAreaFetching = false;
  }
}


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
  // 【③霧の濃さはここ】現在は0.3で一定（件数の違いは色で表現する）。
  //   全体を濃くしたいときは MIN を上げる。件数で濃さを変えたいときは
  //   MAX を 0.4〜0.5 に上げる（処理の負担は増えない）。
  // ============================================================
  const MIN_CLOUD_OPACITY = 0.5;
  const MAX_CLOUD_OPACITY = 0.5;
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
const CLOUD_CACHE_MAX = 150;   // 保持する霧画像の最大数
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
// ★深くズームした状態では、この値を下げても見た目は変わらない★
//   HARD_MAX_CLOUD_PX(このファイル上部)の上限が先に効いているため。
//   その場合の調整先は次の2つ。
//     ・HARD_MAX_CLOUD_PX を下げる（画面上の霧が素直に小さくなる）
//       ただし350を下回ると、投稿地点に色が届かなくなるので下限は350。
//     ・MIN_CAMERA_DISTANCE_METERS_SP / _PC（setupMap の中にある）を
//       上げてズームを浅く制限する。法的リスク対策は強まる方向。
// ============================================================
const MIN_COVERAGE_RADIUS_METERS = 120;

// 画面1pxが現実世界で何メートルに相当するかを返す。
// 霧調整エリアで「霧の半径ぶん外へずらす」距離を計算するのに使う。
function calcMetersPerPixel(map: any, containerEl: HTMLDivElement | null): number {
  if (!containerEl) return 0;
  const span = map.region.span;
  const centerLat = map.region.center.latitude;
  const METERS_PER_DEGREE_LAT = 111320;
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos((centerLat * Math.PI) / 180);
  const containerWidth = containerEl.clientWidth || 1;
  const containerHeight = containerEl.clientHeight || 1;
  const mLat = (span.latitudeDelta * METERS_PER_DEGREE_LAT) / containerHeight;
  const mLng = (span.longitudeDelta * metersPerDegreeLng) / containerWidth;
  return (mLat + mLng) / 2;
}

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
  //
  // ★2026-07-27 注意★
  // ここで onMapClick を2回呼ぶ（①ピンだけ ②住所つき）。
  // 受け側の page.tsx は、②が来たときにピンの位置を動かさず住所だけを
  // 差し込む作りになっている。page.tsx の handleMapClick を編集する
  // ときは、この2回呼びを前提に考えること。
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
  // ★2026-07-29 差分更新化に伴い、配列→Map(名札→マーカー)に変更。
  //   Mapのforeachも「値」が第1引数なので、下の処理本体は変更不要。
  markersRef: { current: Map<string, any> },
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
  // ★2026-07-29：この吹き出しの中は、地図のタッチ遮断から必ず除外する
  //   ための目印（AppleMap側の guardMapInput が見ている）。
  container.dataset.justposted = "1";
  container.style.cssText =
    "background:#FFFFFF;border-radius:12px;padding:14px 16px;box-shadow:0 4px 16px rgba(0,0,0,0.18);min-width:220px;max-width:280px;text-align:left;" +
    // ★2026-07-29：文字の選択・コピーを禁止する。
    //   長押しでiOSの選択メニューが出るのを防ぐのが主目的。
    //   あれは「タッチに反応する挙動」そのもので、この地図で何度も
    //   固まりの原因になってきた種類のもの。見た目の粗さも同時に消える。
    //   ※子要素にも引き継がれるので、中の文字とボタンにも効く。
    "user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;";

  const title = document.createElement("p");
  title.textContent = "投稿を受け付けました";
  title.style.cssText =
    "margin:0 0 4px;font-size:14px;font-weight:700;color:#662510;letter-spacing:0.02em;";
  container.appendChild(title);

  const note = document.createElement("p");
  note.textContent = "修正する場合は、投稿を取り消してから再投稿してください。";
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
  closeBtn.textContent = "閉じる";
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
// ============================================================
// 🔁 差分更新（2026-07-29 段階1）
//
// 【従来】毎回、全マーカーを削除 → 全マーカーを作り直し → 全部追加。
//   パンで少し動かしただけでも、画面内の全部が消えて再生成されていた。
//
// 【現在】マーカーごとに「名札(キー)」を付けて前回分と照合し、
//   ・前回と同じ名札のマーカー … 地図に一切触らず、そのまま使い回す
//   ・前回あって今回無いもの   … その分だけ削除
//   ・今回新しく必要なもの     … その分だけ追加
//   にする。markersRef は配列ではなく Map(名札→マーカー) で持つ。
//
// 【効果の見込み】パン時は端の出入り分だけの操作になる（推定：大幅減）。
//   ズーム時はサイズが変わるため名札も変わり、結果的に従来同様の
//   全入れ替えになる（＝ズーム時の挙動は従来と同じ。悪化はしない）。
// ============================================================
function renderMarkers(
  map: any,
  markersRef: { current: Map<string, any> },
  clusterIndexRef: { current: Supercluster | null },
  containerEl: HTMLDivElement | null
) {
  if (!clusterIndexRef.current) return;

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

  // 今回の描画で「あるべきマーカーの一覧」を名札付きで組み立てる
  const next = new Map<string, any>();
  const toAdd: any[] = [];

  for (const c of clusters as any[]) {
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
    // 座標(offsetLat, offsetLng)を、表示・当たり判定の基準にする。
    // ※霧調整エリア内の投稿は、このあと外向きにさらにずらす（letにしてある）
    const { deltaLat, deltaLng } = calcOffsetLatLng(seed, lat);
    let offsetLat = lat + deltaLat;
    let offsetLng = lng + deltaLng;

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

      // ============================================================
      // 🌫️ 霧調整エリアの適用（2026-07-22）
      //
      // この投稿が調整エリアの中にある場合、
      //   ① 霧を size_scale 倍に縮める
      //   ② 建物（エリアに重なる投稿禁止エリア）の中心から見て
      //      外向きに、霧の半径ぶん＋margin_m だけ中心をずらす
      // これで、霧が建物にかからなくなる。
      //
      // ★調整値の変更は、管理画面の霧調整エリアの登録内容
      //   （大きさの倍率 size_scale／余裕 margin_m）で行う。
      //   コード側の既定値は上の型定義の初期値とSQLのdefaultを参照。
      // ============================================================
      const area = findFogAdjustArea(lat, lng);
      if (area) {
        // ① 縮める
        displaySize = Math.max(8, Math.round(displaySize * area.size_scale));

        // ② 外向きにずらす。
        //    ★重要：霧の画像には余白が含まれる（CLOUD_PADDING_RATIO=1.8）。
        //      見た目の霧のふちは画像の端より内側にあるので、ずらす距離は
        //      「画像サイズ÷2」ではなく「余白を除いた実際の半径」で計算する。
        //      ここを画像サイズで計算すると2倍近くずれてしまう（修正済み）。
        const metersPerPx = calcMetersPerPixel(map, containerEl);
        const visibleRadiusPx = displaySize / 2 / CLOUD_PADDING_RATIO;
        const radiusM = visibleRadiusPx * metersPerPx;
        // margin_m は微調整用：0なら霧のふちが投稿地点に接する。
        // マイナスにすると内側へ寄る（＝投稿地点に霧が重なる）。
        const shiftM = Math.max(0, radiusM + area.margin_m);

        // 建物の中心 → この投稿 の向き（＝外向き。角なら斜めになる）
        const dLat = lat - area.center_lat;
        const dLng = lng - area.center_lng;
        // 緯度経度の1度あたりの距離差を補正して、実際の方角に合わせる
        const latScale = 111320;
        const lngScale = 111320 * Math.cos((lat * Math.PI) / 180);
        const vx = dLng * lngScale;
        const vy = dLat * latScale;
        const len = Math.hypot(vx, vy);
        if (len > 0.001) {
          const ux = vx / len;
          const uy = vy / len;
          offsetLat += (uy * shiftM) / latScale;
          offsetLng += (ux * shiftM) / lngScale;
        }
      }

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

    // ============================================================
    // 🔖 このマーカーの名札(キー)。
    // 位置・モード(霧/円)・件数・色・サイズが全部同じなら「同じマーカー」
    // とみなして使い回す。どれか1つでも違えば別物として作り直す。
    // ※霧の形はseedで決まり、seedは座標から決まるので、位置が同じなら
    //   形も同じ。名札に形の情報を別途入れる必要はない。
    // ============================================================
    let key =
      `${Math.round(offsetLat * 1e6)}_${Math.round(offsetLng * 1e6)}_` +
      `${isCloudZoom ? "f" : "c"}_${count}_${colorCount}_${displaySize}`;
    while (next.has(key)) key += "*"; // 万一名札が重複したらずらして衝突を防ぐ

    const existing = markersRef.current.get(key);
    if (existing) {
      // 前回と同じマーカー：地図に一切触らず、そのまま引き継ぐ
      markersRef.current.delete(key);
      next.set(key, existing);
      continue;
    }

    // 調整エリアによるずらしを反映した最終座標で、表示位置を決める
    const coordinate = new window.mapkit.Coordinate(offsetLat, offsetLng);

    // ============================================================
    // マーカー生成（2026-07-22 シンプル化・引き算）
    //
    // 今日の泥沼の元凶だった「全マーカー触覚ゼロ＋自前タップ判定＋
    // タッチ監視で地図をいじる」構成を撤去。素のMapKitに戻す：
    //   ・霧(isCloudZoom) … タップ不要なので enabled:false（素通し）
    //   ・円(🪳+数字)     … タップで展開ズーム。標準の enabled:true ＋
    //                        アノテーションの select イベントで処理する。
    // 地図をいじるコード(isZoomEnabled等)を一切持たないので、
    // 1本指ズーム/霧固まりの発生源そのものが無くなる。
    // ============================================================
    const annotation = new window.mapkit.ImageAnnotation(coordinate, {
      url: { 1: icon },
      size: { width: displaySize, height: displaySize },
      anchorOffset: new DOMPoint(0, -displaySize / 2),
    });

    // 霧はタップ不可（素通し）、円はタップ可（展開ズーム）
    annotation.enabled = isCluster && !isCloudZoom;
    // ★2026-07-29：投稿フロー(applyAnnotationInteractivity)から復帰するとき
    // に戻す「本来の値」。従来はここで設定しておらず、復帰時に霧まで
    // enabled:true に戻っていた(＝霧がタップを吸収しうる状態・推定)。
    // 差分更新でマーカーが長生きするようになるため、明示的に持たせる。
    (annotation as any).__baseEnabled = isCluster && !isCloudZoom;

    if (isCluster && !isCloudZoom) {
      annotation.addEventListener("select", () => {
        try {
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
        } catch { /* noop */ }
        try { annotation.selected = false; } catch { /* noop */ }
      });
    }
    next.set(key, annotation);
    toAdd.push(annotation);
  }

  // 前回あって今回無いマーカー(markersRefに残った分)だけ削除し、
  // 今回新しく必要になった分(toAdd)だけ追加する。
  // 使い回したマーカーには一切触らないので、地図への操作量が最小になる。
  const stale = Array.from(markersRef.current.values());
  if (stale.length > 0) map.removeAnnotations(stale);
  if (toAdd.length > 0) map.addAnnotations(toAdd);
  markersRef.current = next;
}

// ============================================================
// ============================================================
// 🧱 ここから下は【新方式（タイル集計）】専用。2026-07-29 段階4
//
// 【旧方式との関係】
// 上の renderMarkers（旧方式）には一切手を触れていない。
// 新方式は ?mode=tile を付けたときだけ動く完全な別系統で、
// 一般の訪問者は今まで通り旧方式のまま。ここが壊れても
// サイトは何も影響を受けない。
//
// 【なぜ共通化しないのか】
// 霧の大きさ計算や調整エリアの処理は旧方式とほぼ同じで、
// まとめれば短く書ける。だが、まとめる作業は旧方式のコードを
// 書き換えることに他ならない。新旧を並べて見比べる段階で
// 旧方式に手を入れたら、比較の意味が無くなる。
// ★新方式が正式採用になった時点で、旧方式ごと削除して
//   この重複を解消すること。それまでは意図的に重複させる。
//
// 【前回2回の失敗を繰り返さないための要点】
//  ① タイルを supercluster に食わせない。
//     1マス＝1点なのでズームしても分岐せず、塊のまま固まる。
//     サーバーが返したマスを、そのまま1個ずつ描く。
//  ② ズームの穴を作らない。マスは z0〜z19 の全段階を作ってあり、
//     下の calcTileZoom は必ずこの範囲に丸める。日本全体を
//     表示しても0件にならない。
// ============================================================

// 1マスを画面上でおよそ何pxの大きさに見せるか。
// 小さくすると、細かいマスを使う＝霧やアイコンの数が増える。
// 大きくすると、粗いマスを使う＝数が減ってまとまる。
// ★新旧を見比べて「粒が細かすぎる/粗すぎる」と感じたらここを変える★
const TILE_TARGET_PX = 100;

// 集計表に用意してある最も細かい段階。SQL側と必ず揃えること。
// ★2026-07-29：19→21に変更。約15m四方になり、霧(覆う半径45m以上)が
//   マスより必ず大きくなるため、「同じマスの遠い位置に投稿すると
//   霧が届かない」が構造的に起きなくなる。
//   色は変わらず z19 の3×3(≒半径120m相当)から取る。その変換は
//   SQL側(tiles_in_bounds)がやるので、アプリはこの数字を変えるだけ。
const TILE_MAX_Z = 21;

// ============================================================
// 画面の中央何割ぶんを問い合わせるか。★ここで調整する★
// 大きくすると端まで描かれ、表示件数が見えている範囲と一致する。
// ただし霧・アイコンの数が面積比で増える（0.6→1.0で約2.8倍）。
// ★上げるなら霧とアイコンを別々に、1つずつ変えて確認すること★
//   過去に霧側を1.0にして数が増えすぎ、地図が固まったことがある。
// ============================================================
const TILE_VIEWPORT_RATIO_FOG = 0.6;  // 霧モード（深いズーム）
const TILE_VIEWPORT_RATIO_ICON = 1.0; // 🪳アイコンモード（浅いズーム）

// ============================================================
// 今の縮尺で、どの段階のマスを使うかを決める
//
// 【霧モードで必ずz19にする理由】★重要★
// 色に使う color_cnt は「そのマスと周囲8枚（3×3）の合計」。
// z19の3×3がちょうど約190m四方で、現行の nearby_count
// （半径120m以内の件数）とほぼ同じ範囲になる。
// もし霧モードでz16のマスを使うと、3×3が約1.5km四方になり、
// 件数が桁違いに増えて画面全体が紫（81件以上）になってしまう。
// 色を正しく出せるのはz19だけなので、霧モードは常にz19を使う。
//
// 【アイコンモード（浅いズーム）】
// 色を使わない（ブランドカラー固定）ので、見やすさだけで決める。
// 1マスが画面上で TILE_TARGET_PX 程度に見える段階を選ぶ。
// ============================================================
function calcTileZoom(
  map: any,
  containerEl: HTMLDivElement | null,
  isCloudZoom: boolean
): number {
  if (isCloudZoom) return TILE_MAX_Z;
  const span = map.region.span;
  const containerWidth = containerEl?.clientWidth || SUPERCLUSTER_TILE_SIZE;
  const raw =
    Math.log2(360 / span.longitudeDelta) + Math.log2(containerWidth / TILE_TARGET_PX);
  return Math.max(0, Math.min(TILE_MAX_Z, Math.round(raw)));
}

// ============================================================
// 画面に映っている範囲のマスを、サーバーから取ってくる
//
// p_from は期間フィルター用（段階3で使う）。今は常にnull＝全期間。
// 「その月以降だけ数える」という意味で、月の1日を渡す。
// ============================================================
type TileRow = {
  x: number;
  y: number;
  cnt: number;
  lat: number;
  lng: number;
  color_cnt: number;
};

async function fetchTiles(
  map: any,
  tileZ: number,
  fromMonth: string | null,
  viewportRatio: number
): Promise<{ rows: TileRow[] | null; error: string | null }> {
  try {
    const span = map.region.span;
    const center = map.region.center;
    const r = viewportRatio;

    const { data, error } = await supabase.rpc("tiles_in_bounds", {
      p_z: tileZ,
      p_min_lat: center.latitude - (span.latitudeDelta * r) / 2,
      p_min_lng: center.longitude - (span.longitudeDelta * r) / 2,
      p_max_lat: center.latitude + (span.latitudeDelta * r) / 2,
      p_max_lng: center.longitude + (span.longitudeDelta * r) / 2,
      p_from: fromMonth,
    });

    if (error) return { rows: null, error: error.message ?? "取得に失敗しました" };
    return { rows: (data ?? []) as TileRow[], error: null };
  } catch (e: any) {
    return { rows: null, error: e?.message ?? "通信に失敗しました" };
  }
}

// ============================================================
// 🔗 受け取ったマスを、画面上で近いもの同士まとめる（2026-07-29）
//
// 【なぜ必要か】
// マスは格子なので、日本列島のような細長い範囲は格子の境目で
// 分断される。ズームアウトしても1個にまとまらず、2〜4個に割れる。
// superclusterは「距離が近いものをまとめる」ので1個になっていた。
// その挙動を取り戻すための処理。
//
// 【なぜ軽いか】
// まとめる対象は、3万件の投稿ではなく、サーバーが返した数十個の
// マスだけ。総当たりで比べても一瞬で終わる。
// ＝「重いからDB側で集計する」という方針とは矛盾しない。
//
// 【まとめ方】
//  ・件数の多いマスを親にして、そこから半径 MERGE_RADIUS_PX 以内の
//    マスを吸収する
//  ・件数は合計、色は最大値（旧方式の reduce と同じ考え方＝安全側）
//  ・位置は親のまま。親は「そのマスで最も古い投稿」の位置に固定
//    されているので、新規投稿が増えても霧が動かない
// ============================================================
// ============================================================
// まとめる距離（px）。★アイコンの数を調整したいときはここ★
//
// 【なぜ2つあるか】実測の結果、1つの値では両立できなかった。
//   100pxだと … 市街地は適度(21個)だが、日本全体で4個に割れる
//   300pxだと … 日本全体は1個になるが、市街地が6個まで減って粗い
// 格子は境目で必ず分断されるので、日本列島のような細長い範囲を
// 1個にまとめるには、どうしても広い距離が要る。そこで、
// 日本全体が入るような広い表示のときだけ、まとめる距離を広げる。
//
//   MERGE_RADIUS_PX_WIDE   … 広域表示のとき（大きいほどまとまる）
//   MERGE_RADIUS_PX_NEAR   … 寄った表示のとき（superclusterのradius:100と同値）
//   WIDE_VIEW_LNG_DEG      … 経度でこの幅より広ければ「広域」と判定
// ============================================================
const MERGE_RADIUS_PX_WIDE = 300;
const MERGE_RADIUS_PX_NEAR = 100;
const WIDE_VIEW_LNG_DEG = 8;

// ★2026-07-29 修正：霧モードでまとめてよい距離は、固定pxではなく
//   「霧が実際に色をつけている範囲」から計算する。
//
// 【何が問題だったか】
// 霧の画像には余白が含まれる（CLOUD_PADDING_RATIO=1.8）。そのため
// 実際に色が見える半径は、設定値 MIN_COVERAGE_RADIUS_METERS(120m) の
// 1.8分の1＝約67mしかない。
// 一方まとめる距離は100pxという画面上の固定値で、深いズームでは
// 90m前後に相当していた。
// ＝67mしか覆えない霧が、90m先の投稿まで吸い込んでいた。
// その差に投稿すると「吸収されたのに、そこに色がつかない」となる。
//
// 【対策】まとめる距離を、霧が実際に覆う半径までに制限する。
// こうすると、吸収された投稿は必ずその霧の内側に入る。
// 画面の縮尺が変わっても、実世界の距離としては常に同じになる。
//
// 1.0 ＝ 霧のふちまで吸収してよい
// 下げるほど、独立した霧ができやすくなる（霧の数は増える）
const FOG_MERGE_COVERAGE_RATIO = 1.0;

// 霧の画像に含まれる余白の比率。createCloudIconUrl の PADDING と連動
// （0.4×2＋1＝1.8）。旧方式の同名の値と必ず同じにすること。
const TILE_CLOUD_PADDING_RATIO = 1.8;

type MergedTile = { lat: number; lng: number; count: number; colorCount: number };

function mergeTilesOnScreen(
  map: any,
  containerEl: HTMLDivElement | null,
  items: MergedTile[],
  radiusPx: number
): MergedTile[] {
  if (items.length <= 1 || radiusPx <= 0) return items;

  // ============================================================
  // ★2026-07-29 改善：画面上の位置を自前で計算する
  //
  // 【なぜ変えたか】以前はマス1個ごとに地図(MapKit)の座標変換を
  // 呼んでいた。マスが細かくなると1回の描画で数百回呼ぶことになり、
  // 描画中に地図の内部処理へ触れる回数がそのまま増える。
  // 固まりの原因は一貫して「描画と地図の動作がぶつかること」だったので、
  // 触る回数は減らせるだけ減らす。
  //
  // 【精度】ここで欲しいのは「近いか遠いか」だけ。画面1枚ぶんの狭い
  // 範囲では、緯度経度をそのまま比例配分しても誤差は1%に満たない。
  // まとめる判断には十分。
  // ============================================================
  const width = containerEl?.clientWidth || 0;
  const height = containerEl?.clientHeight || 0;
  if (width <= 0 || height <= 0) return items;

  const span = map.region.span;
  const center = map.region.center;
  if (!span || !center || span.latitudeDelta <= 0 || span.longitudeDelta <= 0) {
    return items;
  }

  const pts = items.map((it) => ({
    x: width / 2 + ((it.lng - center.longitude) / span.longitudeDelta) * width,
    y: height / 2 - ((it.lat - center.latitude) / span.latitudeDelta) * height,
  }));

  // 件数の多い順に親を決める（大きい塊が中心になるように）
  const order = items.map((_, i) => i).sort((a, b) => items[b].count - items[a].count);
  const used = new Array(items.length).fill(false);
  const result: MergedTile[] = [];

  for (const i of order) {
    if (used[i]) continue;
    used[i] = true;
    let count = items[i].count;
    let colorCount = items[i].colorCount;

    for (const j of order) {
      if (used[j]) continue;
      const dx = pts[i].x - pts[j].x;
      const dy = pts[i].y - pts[j].y;
      if (Math.hypot(dx, dy) <= radiusPx) {
        used[j] = true;
        count += items[j].count;
        colorCount = Math.max(colorCount, items[j].colorCount);
      }
    }
    result.push({ lat: items[i].lat, lng: items[i].lng, count, colorCount });
  }
  return result;
}

// ============================================================
// 取ってきたマスを、そのまま霧・🪳アイコンとして描く
//
// 差分更新（段階1）の仕組みはそのまま使う。名札が同じマーカーは
// 地図に触らず使い回し、増減分だけを操作する。
// ============================================================
function renderTileMarkers(
  map: any,
  markersRef: { current: Map<string, any> },
  containerEl: HTMLDivElement | null,
  rows: TileRow[],
  currentZoom: number,
  tileZ: number
): number {
  const next = new Map<string, any>();
  const toAdd: any[] = [];

  // ============================================================
  // 色に使う件数の決め方（★2026-07-29 修正★）
  //
  // color_cnt は「そのマスと周囲8枚（3×3）の合計」。
  // z19の3×3は約190m四方で、現行の nearby_count（半径120m以内）と
  // ほぼ同じ範囲になる。だからz19のときだけ正しい。
  //
  // 浅いズーム（例：z14＝1マス約2.4km）の3×3は約7km四方。
  // この合計を色に使うと、実際は1件しかない場所が紫（81件以上）に
  // 塗られ、ズームすると色が変わる・消えるという不具合になる。
  // （旧方式で色をDB側の固定値にした狙いを、私が台無しにしていた）
  //
  // 浅いズームでは自分のマスの件数をそのまま使う。1件だけのマスは
  // 「そのマス全体で1件」という意味なので、半径120m以内も必ず1件。
  // これは近似ではなく正しい値になる。
  // ============================================================
  const rawItems: MergedTile[] = [];
  for (const row of rows) {
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const count = Math.max(1, Number(row.cnt) || 1);
    const colorCount =
      tileZ === TILE_MAX_Z
        ? Math.max(1, Number(row.color_cnt ?? count) || 1)
        : count;
    rawItems.push({ lat, lng, count, colorCount });
  }

  // 表示の広さで、まとめる距離を切り替える（上の定数のコメントを参照）
  let radiusPx: number;
  if (tileZ === TILE_MAX_Z) {
    // ============================================================
    // 霧モード：まとめてよい距離＝「霧が実際に色をつけている半径」
    //
    // ★2026-07-29 再修正★
    // 前回は「120m ÷ 余白1.8 ＝ 約67m」と机上で計算していたが、
    // 霧には HARD_MAX_CLOUD_PX(700px) という上限があり、最大ズームでは
    // ここに当たって霧が想定より小さくなる。その状態でまとめる距離だけ
    // 67mのままだと、また「吸収したのに色が届かない」が起きる。
    //
    // そこで、実際に描くときと同じ手順で「1件のマスの霧の大きさ」を
    // 求め、その見た目の半径をそのまま使う。上限に当たった場合も
    // 自動的に小さくなるので、覆えない距離まで吸収することがない。
    // ============================================================
    const minCoverageSize = calcMinCoverageSizePx(map, containerEl);
    const natural1 = Math.round(calcCircleSize(1) * TILE_CLOUD_PADDING_RATIO);
    const floor1 = Math.min(
      Math.max(natural1, minCoverageSize),
      HARD_MAX_CLOUD_PX
    );
    // 画像の余白を除いた、実際に色が見えている半径（px）
    const visibleRadiusPx = floor1 / 2 / TILE_CLOUD_PADDING_RATIO;
    radiusPx = visibleRadiusPx * FOG_MERGE_COVERAGE_RATIO;
  } else {
    radiusPx =
      map.region.span.longitudeDelta >= WIDE_VIEW_LNG_DEG
        ? MERGE_RADIUS_PX_WIDE
        : MERGE_RADIUS_PX_NEAR;
  }
  const items = mergeTilesOnScreen(map, containerEl, rawItems, radiusPx);

  for (const item of items) {
    const { lat, lng, count, colorCount } = item;

    // 旧方式と同じ規則：1件だけのマスは、縮尺に関係なく必ず霧にする
    const isCloudZoom = count === 1 || currentZoom >= CLOUD_ZOOM_THRESHOLD;

    // 霧の形とずらし量は座標から決める（旧方式と同じ計算）。
    // ★新方式では代表点が「そのマスで最も古い投稿」に固定されているので、
    //   近くに新規投稿があっても代表点は動かない。
    //   ＝旧方式にあった「投稿すると近くの霧が動く」現象が起きない。
    const seed = Math.abs(Math.round(lat * 1e6) * 1000003 + Math.round(lng * 1e6));
    const { deltaLat, deltaLng } = calcOffsetLatLng(seed, lat);
    let offsetLat = lat + deltaLat;
    let offsetLng = lng + deltaLng;

    const baseSize = calcCircleSize(count);
    const minCoverageSize = calcMinCoverageSizePx(map, containerEl);
    const CLOUD_PADDING_RATIO = 1.8;

    let displaySize: number;
    let icon: string;

    if (isCloudZoom) {
      const naturalDisplaySize = Math.round(baseSize * CLOUD_PADDING_RATIO);
      const floorSize = Math.max(naturalDisplaySize, minCoverageSize);
      const growth = calcCloudGrowthPx(count);
      displaySize = Math.max(
        floorSize,
        Math.min(floorSize + growth, MAX_CLOUD_DISPLAY_SIZE_PX)
      );
      displaySize = Math.min(displaySize, HARD_MAX_CLOUD_PX);

      // 🌫️ 霧調整エリア（削除依頼のあった建物に霧をかけない仕組み）。
      //    旧方式と同じ処理。ここも将来まとめること。
      const area = findFogAdjustArea(lat, lng);
      if (area) {
        displaySize = Math.max(8, Math.round(displaySize * area.size_scale));
        const metersPerPx = calcMetersPerPixel(map, containerEl);
        const visibleRadiusPx = displaySize / 2 / CLOUD_PADDING_RATIO;
        const radiusM = visibleRadiusPx * metersPerPx;
        const shiftM = Math.max(0, radiusM + area.margin_m);
        const dLat = lat - area.center_lat;
        const dLng = lng - area.center_lng;
        const latScale = 111320;
        const lngScale = 111320 * Math.cos((lat * Math.PI) / 180);
        const vx = dLng * lngScale;
        const vy = dLat * latScale;
        const len = Math.hypot(vx, vy);
        if (len > 0.001) {
          offsetLat += ((vy / len) * shiftM) / latScale;
          offsetLng += ((vx / len) * shiftM) / lngScale;
        }
      }

      const coreSize = Math.round(displaySize / CLOUD_PADDING_RATIO);
      icon = getCachedCloudIconUrl(count, colorCount, coreSize, seed);
    } else {
      displaySize = Math.min(Math.max(baseSize, minCoverageSize), MAX_CIRCLE_DISPLAY_SIZE_PX);
      icon = getCachedClusterIconUrl(count, displaySize);
    }

    // 名札（差分更新の照合用）。旧方式と同じ作り方。
    let key =
      `t${tileZ}_${Math.round(offsetLat * 1e6)}_${Math.round(offsetLng * 1e6)}_` +
      `${isCloudZoom ? "f" : "c"}_${count}_${colorCount}_${displaySize}`;
    while (next.has(key)) key += "*";

    const existing = markersRef.current.get(key);
    if (existing) {
      markersRef.current.delete(key);
      next.set(key, existing);
      continue;
    }

    const coordinate = new window.mapkit.Coordinate(offsetLat, offsetLng);
    const annotation = new window.mapkit.ImageAnnotation(coordinate, {
      url: { 1: icon },
      size: { width: displaySize, height: displaySize },
      anchorOffset: new DOMPoint(0, -displaySize / 2),
    });

    // 霧はタップ素通し、🪳アイコンはタップで拡大
    const tappable = !isCloudZoom;
    annotation.enabled = tappable;
    (annotation as any).__baseEnabled = tappable;

    if (tappable) {
      annotation.addEventListener("select", () => {
        try {
          // 旧方式はクラスタが分裂する縮尺へ飛んでいたが、新方式に
          // 「分裂する縮尺」という概念は無い。今のマス2枚ぶんの幅まで
          // 寄る＝1段階ズームインする、という素直な動きにしてある。
          // ★寄り方を変えたいときは、この 2 を小さくする（強く寄る）★
          const newSpanDeg = (360 / Math.pow(2, tileZ)) * 2;
          map.setRegionAnimated(
            new window.mapkit.CoordinateRegion(
              new window.mapkit.Coordinate(offsetLat, offsetLng),
              new window.mapkit.CoordinateSpan(newSpanDeg, newSpanDeg)
            )
          );
        } catch { /* noop */ }
        try { annotation.selected = false; } catch { /* noop */ }
      });
    }

    next.set(key, annotation);
    toAdd.push(annotation);
  }

  const stale = Array.from(markersRef.current.values());
  if (stale.length > 0) map.removeAnnotations(stale);
  if (toAdd.length > 0) map.addAnnotations(toAdd);
  markersRef.current = next;
  return next.size; // バッジに出す「実際に描いた数」
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
    showAreas = false,
    onOutOfService,
  },
  ref
) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const reportMarkerRef = useRef<any>(null);
  const justPostedMarkerRef = useRef<any>(null);
  // ★2026-07-29：確認ピンが出ている間かどうかを、reportPos側の処理からも
  //   参照できるようにする（ズームロックの取り合いを防ぐため。下を参照）
  const justPostedActiveRef = useRef(false);
  // ★2026-07-29 修正：この値は「描画のたび」にここで合わせる。
  //
  // 【なぜここか】投稿が完了すると、justPosted のセットと
  // refreshTrigger の更新が同時に起きる。このとき
  //   ・refreshTrigger の useEffect（描き直し）… 先に走る
  //   ・justPosted の useEffect（この値の更新）… 後に走る
  // という順番になるため、あちらで更新していると「まだ確認画面は
  // 開いていない」と誤判定され、確認画面が出ているのに霧が描かれた。
  // ここで合わせておけば、どのuseEffectから見ても必ず最新になる。
  justPostedActiveRef.current = !!justPosted;
  // ★2026-07-29 差分更新化：配列 → Map(名札→マーカー) に変更
  const markersRef = useRef<Map<string, any>>(new Map());
  const clusterIndexRef = useRef<Supercluster | null>(null);
  // 描き直しの入口（reports変更時などはこの参照を通して描き直す）
  const requestRenderRef = useRef<() => void>(() => {});
  const [reports, setReports] = useState<Report[]>([]);

  // ============================================================
  // 🧱 表示方式の切り替え（2026-07-30 既定を新方式に変更）
  //
  // 【変更前】?mode=tile を付けたときだけ新方式（試験運用）
  // 【変更後】既定が新方式。?mode=legacy を付けたときだけ旧方式
  //
  // 公開前で訪問者がいないため、この時点で切り替えた。
  // 何か起きたら ?mode=legacy を付ければ、その場で旧方式に戻せる。
  //
  // ★旧方式のコード（renderMarkers・supercluster・全件取得）は、
  //   新方式で一定期間運用して問題が出ないと確認できたら削除すること。
  //   700行以上が消え、このファイルはかなり読みやすくなる。
  // ============================================================
  const [tileMode] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return new URLSearchParams(window.location.search).get("mode") !== "legacy";
    } catch {
      return true;
    }
  });
  // 開発用バッジ（?mode=tile を明示したときだけ出す）。
  // 既定が新方式になったので、普段の画面には出さない。
  const [tileDebug] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return new URLSearchParams(window.location.search).get("mode") === "tile";
    } catch {
      return false;
    }
  });
  // 新方式の状態表示（バッジに出す）。取得に失敗したら理由を出す。
  const [tileStatus, setTileStatus] = useState<string>("");

  // ============================================================
  // 🗓 期間フィルター（2026-07-30 段階3）
  //
  // 集計は月ごとに持っているので、絞り込みは「この月以降を数える」
  // という形になる。1日単位ではなく月単位。
  //
  // ・過去3か月 … 今月を含めて3か月（7月なら5/1以降）
  // ・過去1年   … 今月を含めて12か月（7月なら前年8/1以降）
  //
  // 月初だと実際の期間が短めになるが、それを隠さずに
  // 「2026/05/01〜現在」と画面に出すことで、誤解を防いでいる。
  //
  // ★期間を絞ると、色（件数による色分け）も同じ期間で計算し直される。
  //   3か月で絞れば3か月ぶんの件数に応じた色になる。SQL側で対応済み。
  // ============================================================
  type PeriodMode = "all" | "1y" | "3m";
  const [period, setPeriod] = useState<PeriodMode>("all");
  const [filterOpen, setFilterOpen] = useState(false);

  // ★選択肢の文言はここ。変えたいときはこの3つだけ直せばよい。
  const PERIOD_LABELS: Record<PeriodMode, string> = {
    all: "全期間",
    "1y": "過去1年",
    "3m": "過去3か月",
  };

  // 絞り込みの開始月（その月の1日）。全期間ならnull。
  const periodFrom = (() => {
    if (period === "all") return null;
    const now = new Date();
    const back = period === "1y" ? 11 : 2;
    const start = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const y = start.getFullYear();
    const m = String(start.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}-01`;
  })();
  // 描画処理（地図の初期化時に作られる）から参照できるようにしておく
  const periodFromRef = useRef<string | null>(null);
  periodFromRef.current = periodFrom;

  // ============================================================
  // 📱 スマホ判定（2026-07-19 追加）
  // 画面幅768px未満をスマホ扱いとし、凡例の位置・サイズや
  // ズーム上限などをPC/スマホで出し分けるのに使う。
  // ============================================================
  const [isMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );

  // ============================================================
  // 🎨 目撃件数の凡例（PC・スマホとも左下）
  // ============================================================
  // 📐【画面まわりの余白・高さの調整はここ】(2026-07-30 スマホ/PC分離)
  //
  // ★スマホとPCで別々に設定できる★
  //   まずスマホ(UI_SP)を決め、あとからPC(UI_PC)を調整する運用。
  //   片方を変えても、もう片方には影響しない。
  //
  // ・edge      … 画面の端からの距離。上下左右すべて共通。
  //               この1つの数字で「右上と右下の右端が揃う」。
  // ・rowH      … 上段の高さ。絞り込み・検索バー・現在地の3つが
  //               必ずこの高さ（＝丸ボタンの直径）になる。
  // ・gap       … 上段の部品どうしの間隔。
  // ・bottom    … 凡例の下端からの距離。この値は凡例だけに効く。
  //               page.tsx のGボタンより数px大きいのは、Gの円の影が
  //               下に伸びて見えるぶんを合わせた意図的な補正。
  const UI_BOX_H = 52;

  const UI_SP = { edge: 12, rowH: 36, gap: 8, bottom: 35, searchMax: 9999 };
  const UI_PC = { edge: 12, rowH: 36, gap: 8, bottom: 35, searchMax: 420 };
  const UI = isMobile ? UI_SP : UI_PC;

  // ============================================================
  // 🎨 凡例の見た目
  // ★2026-07-30：Gボタンの「目撃情報を報告する」の箱と揃えた★
  //   pad・font・角の丸み・文字色を同じにしてあるので、閉じた状態の
  //   高さがGボタンのラベルとぴったり並ぶ。
  //   ★page.tsx 側のラベルを変えたら、ここも同じ数字に合わせること★
  //     page.tsx: padding "14px 18px" / fontSize 14 / borderRadius 10
  // ============================================================
  // font=見出し「目撃件数」の文字 / bodyFont=色見本のラベル
  // swatch=色見本の四角 / line=行間 / openHeadH=見出しと1行目の距離
  // ★font と radius は閉じたときの見た目を決める。他は開いたときだけ効く。
  const LEGEND_SP = { font: 14, bodyFont: 12, swatch: 12, line: 1.6, radius: 10, openHeadH: 34 };
  const LEGEND_PC = { font: 15, bodyFont: 14, swatch: 16, line: 1.8, radius: 10, openHeadH: 38 };
  // 見出し「目撃件数」と▶の色。Gボタンの文字色と同じにしてある。
  const LEGEND_HEAD_COLOR = "#292524";
  // ★凡例を最初から閉じた状態にしたいときは、ここを true にする。
  //   （投稿が増えて画面が賑やかになったら閉じる想定。今は開いたまま）
  const [legendCollapsed, setLegendCollapsed] = useState(false);

  // ============================================================
  // 📍 現在地ボタン
  // MapKit標準のボタンは精度円がタップを吸い取り、投稿位置を選べなく
  // するため使わない。ブラウザの位置情報APIで座標だけ取って地図を動かす。
  // 位置と高さは上段の帯（UI.edge / UI.rowH / UI.gap）が決める。
  // ============================================================

  // 飛んだ先の縮尺。★数値を小さくするほど寄る★
  //   0.002  … 約220m四方
  //   0.0008 … 約90m四方（現在の設定）
  //   0.0005 … 約55m四方
  // ★これ以上寄せても、cameraZoomRange（PC 200m / スマホ 50m）が
  //   上限として効くため、そこで頭打ちになる。
  // ★寄せすぎの注意★ 屋内ではGPSに数十mの誤差が出る。ずれに気づかず
  //   隣の建物で投稿されることがあるので、最後は本人に位置を
  //   合わせてもらう前提で考えること。
  const LOCATE_SPAN = 0.0008;

  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  // ============================================================
  // 🚫 投稿の流れに入っている間は、現在地ボタンを出さない（2026-07-29）
  //
  // 【理由】押すと地図が現在地へ飛ぶ。位置調整ピンや確認画面が出ている
  // 最中に飛ぶと、それらが画面の外に取り残される。ズームは止めてあるので
  // 引いて探すこともできず、閉じるしか手が無くなる。
  //
  // 【止める範囲】ズームを止める条件（applyZoomLock）と同じ3場面に揃えた。
  //   ・場所を選んでいる間 ・位置調整ピンが出ている間 ・確認画面が出ている間
  //
  // 【不便にならない理由】ズームが浅いとGボタンが弾かれる作りなので
  // （page.tsx の isZoomedInEnough）、利用者は必ずGを押す前に地図を
  // 合わせている。後から現在地へ飛ぶ必要は薄い。
  //
  // 【なぜ灰色にせず消すか】Gボタンと同じ考え方。押せないボタンが
  // 残っていると「押してみよう」を誘うだけで、迷いの元になる。
  // ============================================================
  const inReportFlow = isSelecting || !!reportPos || !!justPosted;

  const handleLocate = () => {
    if (locating) return;

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocateError("この端末では現在地を取得できません");
      return;
    }

    setLocating(true);
    setLocateError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        if (!mapRef.current) return;
        // ★2026-07-29：位置情報の取得は最長10秒かかる。押した後に投稿の
        //   流れへ入っていた場合、ここで地図を動かすとピンや確認画面が
        //   画面外に飛ぶ。取得できても動かさない。
        if (
          isSelectingRef.current ||
          reportPosRef.current ||
          justPostedActiveRef.current
        ) {
          return;
        }
        const { latitude, longitude } = position.coords;
        mapRef.current.setRegionAnimated(
          new window.mapkit.CoordinateRegion(
            new window.mapkit.Coordinate(latitude, longitude),
            new window.mapkit.CoordinateSpan(LOCATE_SPAN, LOCATE_SPAN)
          )
        );
      },
      (err) => {
        setLocating(false);
        // 1 = 許可されなかった / 2 = 取得できなかった / 3 = 時間切れ
        if (err.code === 1) {
          setLocateError("位置情報の使用が許可されていません");
        } else {
          setLocateError("現在地を取得できませんでした");
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // 現在地が取れなかったときの案内は、数秒で自動的に消す
  useEffect(() => {
    if (!locateError) return;
    const timer = setTimeout(() => setLocateError(null), 4000);
    return () => clearTimeout(timer);
  }, [locateError]);

  const isSelectingRef = useRef(isSelecting);
  const onMapClickRef = useRef(onMapClick);
  const reportPosRef = useRef(reportPos);
  const reportsRef = useRef<Report[]>([]);
  const onStartInputRef = useRef(onStartInput);
  const onCancelRef = useRef(onCancel);
  const onDismissJustPostedRef = useRef(onDismissJustPosted);
  const onJustPostedDeletedRef = useRef(onJustPostedDeleted);

  // ============================================================
  // 🔒 ズームを止める条件（2026-07-29 1か所に集約）
  //
  // 【なぜ集約するか】
  // ズームを止めたい場面が3つに増えた結果、それぞれの処理が別々に
  // isZoomEnabled を書き換えていた。片方が止めた直後にもう片方が
  // 戻す、という取り合いが起きやすく、実際に一度起きている。
  // 「止める条件」をこの関数だけが判断し、他は全部ここを呼ぶ形にする。
  //
  // 【止める場面】
  //   ・投稿する場所を選んでいる間（Gボタンを押した後〜タップするまで）
  //     …「ズームインしてください」と案内した縮尺のまま選ばせるため。
  //       やり直したい人は、適当にタップしてキャンセルすればよい。
  //   ・位置調整ピンが出ている間
  //   ・投稿直後の確認画面が出ている間
  //     …タッチに反応する物体の上でピンチすると地図が固まるため。
  //
  // 【止めないもの】
  //   横移動(パン)は最後まで自由。止める理由が無く、止めると不便なだけ。
  // ============================================================
  const applyZoomLock = () => {
    const map = mapRef.current;
    if (!map) return;
    const locked =
      isSelectingRef.current ||
      !!reportPosRef.current ||
      justPostedActiveRef.current;
    map.isZoomEnabled = !locked;
  };

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

  // 🗺 エリアの形を線で表示するか（propsで受け取る）
  const showAreasRef = useRef(false);
  const areaOverlaysRef = useRef<any[]>([]);
  const areaLabelsRef = useRef<any[]>([]); // エリアのID番号ラベル
  const drawAreaShapesRef = useRef<() => void>(() => {});
  const drawAreaShapesNowRef = useRef<() => void>(() => {});

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
      "background:#FFFFFF;border-radius:12px;padding:12px 14px;box-shadow:0 4px 16px rgba(0,0,0,0.18);min-width:210px;max-width:270px;text-align:left;" +
      // ★2026-07-29：確認画面と同じ理由で、選択・長押しメニューを禁止する
      "user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;";

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


    // ── 霧だけ非表示ボタン（データは残す。削除依頼物件に隣家の霧が
    //    かかる場合などに、投稿を消さずに地図から隠す用途）──────────
    const hideBtn = document.createElement("button");
    let hidden = r.hidden === true;
    const paintHideBtn = () => {
      hideBtn.textContent = hidden ? "再表示する" : "非表示にする";
      hideBtn.style.cssText =
        "margin-top:8px;width:100%;background:transparent;color:#662510;border:1.5px solid #662510;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;";
    };
    paintHideBtn();
    hideBtn.onclick = async () => {
      const next = !hidden;
      hideBtn.disabled = true;
      hideBtn.textContent = "処理中...";
      try {
        const res = await fetch("/api/admin/reports", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": adminKeyRef.current ?? "",
          },
          body: JSON.stringify({ id: r.id, hidden: next }),
        });
        if (!res.ok) {
          hideBtn.disabled = false;
          paintHideBtn();
          hideBtn.textContent = "失敗しました。もう一度押してください";
          return;
        }
        hidden = next;
        r.hidden = next; // 手元の状態も更新（再度開いた時に正しく出す）
        hideBtn.disabled = false;
        paintHideBtn();
        // 霧を最新化（非表示なら消える・再表示なら戻る）
        fetchReports();
        // 管理ピンも描き直してピンの色（📍⇔🟡）を即反映する
        renderAdminPinsRef.current(map);
      } catch {
        hideBtn.disabled = false;
        paintHideBtn();
        hideBtn.textContent = "通信失敗。もう一度押してください";
      }
    };
    box.appendChild(hideBtn);

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
            div.style.filter = "drop-shadow(0 1px 2px rgba(0,0,0,0.4))";
            // 霧を非表示にした投稿は、通常の📍と区別できるよう🟡にする
            // （紛らわしさ防止。黄色は地図上で目立つ）。通常は📍。
            div.textContent = r.hidden === true ? "🟡" : "📍";
            // ★2026-07-20：📍も触覚ゼロにする。タッチに反応する物体の上で
            //   ピンチするとMapKitのタッチ帳簿が狂う問題の、最後の残存箇所。
            //   タップ判定は地図側single-tapの自前判定で行う（円と同方式）。
            div.style.pointerEvents = "none";
            div.style.userSelect = "none";
            (div.style as any).webkitUserSelect = "none";
            (div.style as any).webkitTouchCallout = "none";
            return div;
          },
          { calloutEnabled: true, calloutOffset: new DOMPoint(0, 6) }
        );
        // 自前タップ判定用（画面上の当たり半径18px＝押しやすさ優先）
        (ann as any).__adminHit = { lat: r.lat, lng: r.lng, radiusPx: 18 };
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

  // 🗺 「エリアを表示」の切り替えを、すぐ地図に反映する
  useEffect(() => {
    showAreasRef.current = showAreas;
    drawAreaShapesNowRef.current();
  }, [showAreas]);
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
    applyZoomLock(); // ★2026-07-29：場所を選んでいる間はズームを止める
  }, [isSelecting, onMapClick]);

  useEffect(() => {
    reportPosRef.current = reportPos;
    applyZoomLock();
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
    // ★2026-07-29：新方式では全件取得そのものを行わない。
    //   マスの集計だけを画面の範囲ぶん取るので、この処理は不要。
    //   ここを止めることで「全件ダウンロードが無くなった効果」が
    //   そのまま体感できる（新旧を切り替えて初回表示を比べること）。
    if (tileMode) return;

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
    //
    // ★既知の限界（2026-07-27 追記）★
    // この方式は「全件をブラウザに持つ」ことが前提。投稿が数十万件を
    // 超えると転送量・メモリの両方で破綻する。そのときは、日本を
    // 約120m四方のマス目に区切り、マスごとの集計値だけを画面の範囲分
    // 配る方式（＝地図・取得・DBの作り直し）への移行が必要。
    // なお nearby_count をDB側で事前計算する現在の設計は、その方式でも
    // そのまま通用する（作り直すのは取得と描画だけ）。
    // ============================================================
    // hidden=true（管理者が「霧だけ非表示」にした投稿）は最初から取得しない。
    // ＝地図に描かれない。データ自体は残るので、いつでも復活できる。
    // 表示処理には一切触れないので、タッチ挙動に影響しない安全な方式。
    const { count, error: countError } = await supabase
      .from("reports")
      .select("id", { count: "exact", head: true })
      .not("hidden", "is", true);

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
          .not("hidden", "is", true)
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
    // ★2026-07-29：新方式は全件取得をしないので、投稿・削除のあとは
    //   マスを取り直して描き直す。ここを入れないと、投稿しても
    //   霧がすぐ出ない（＝この案件で最も守るべき挙動が壊れる）。
    //   集計はDB側のトリガーが投稿と同時に更新済みなので、
    //   取り直せば必ず新しい霧が含まれている。
    if (tileMode) {
      requestRenderRef.current();
      return;
    }
    fetchReports();
  }, [refreshTrigger]);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    const containerEl = mapContainerRef.current;
    let cancelled = false;
    let initialized = false;

    // ============================================================
    // 🔗 投稿の流れの最中、地図へのタッチを制御する（2026-07-29）
    //
    // 【① リンクを押せなくする】
    // 地図の左下にはAppleの法的表示（ロゴ・「Legal」）があり、押すと
    // 別の画面が開く。場所を選んでいる最中に流れが中断されるので止める。
    // 表示はMapKitの利用条件で求められているので、見た目は変えない。
    // クラス名ではなく「リンク(aタグ)なら止める」で判定しているのは、
    // Apple側の更新で内部の名前が変わっても効き続けるようにするため。
    //
    // 【② 確認画面が開いている間は、地図に触らせない】
    // 地図をタップするとMapKitが吹き出しの選択を外す。こちらは
    // 閉じさせない方針なので即座に開き直すが、その一瞬で吹き出しが
    // 閉じて開くため「ピカッと光る」ように見えていた。
    // そもそも地図にタップを届けなければ、選択が外れず、光らない。
    // 副作用として、確認画面が出ている間は横移動もできなくなる。
    // ズームは既に止めてあるので、実質的に「閉じるまで地図は固定」になる。
    //
    // 【安全策】ボタンと吹き出しの中身は必ず通す。ここを塞ぐと
    // 「閉じる」が押せなくなり、利用者が詰む。目印(data-justposted)が
    // 万一効かなくても、buttonタグなら通るよう二重にしてある。
    // ============================================================
    const guardMapInput = (e: Event) => {
      const inFlow =
        isSelectingRef.current ||
        !!reportPosRef.current ||
        justPostedActiveRef.current;
      if (!inFlow) return; // 通常閲覧中は一切邪魔しない

      const el = e.target as HTMLElement | null;
      const closest = (sel: string) =>
        el && typeof el.closest === "function" ? el.closest(sel) : null;

      // 吹き出しの中身（ボタン等）は必ず通す
      if (closest("button, [data-justposted]")) return;

      if (closest("a")) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (justPostedActiveRef.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    containerEl.addEventListener("click", guardMapInput, true);
    containerEl.addEventListener("pointerdown", guardMapInput, true);

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

      // URLに lat/lng があれば、その場所を拡大して開く。
      // 管理画面のエリア一覧の「地図で見る」から飛んできたとき用。
      let initialRegion = new window.mapkit.CoordinateRegion(
        new window.mapkit.Coordinate(36.5, 138.5),
        new window.mapkit.CoordinateSpan(20, 24)
      );
      try {
        const usp = new URLSearchParams(window.location.search);
        const qLat = Number(usp.get("lat"));
        const qLng = Number(usp.get("lng"));
        if (
          usp.get("lat") !== null &&
          usp.get("lng") !== null &&
          Number.isFinite(qLat) &&
          Number.isFinite(qLng)
        ) {
          initialRegion = new window.mapkit.CoordinateRegion(
            new window.mapkit.Coordinate(qLat, qLng),
            new window.mapkit.CoordinateSpan(0.004, 0.004) // 建物が見える程度
          );
        }
      } catch {
        /* URLが読めない場合は既定の全国表示のまま */
      }

      const map = new window.mapkit.Map(mapContainerRef.current, {
        region: initialRegion,
        showsZoomControl: false,
        showsCompass: "hidden",
        isRotationEnabled: false,
        // ★2026-07-19 スマホ対応：右上の「位置情報」「航空写真」ボタンを非表示に
        // ★2026-07-27：現在地は独自ボタン（上の handleLocate）で実装している。
        //   標準ボタンを有効にすると、精度円・青い点・吹き出しが一体で付いてきて
        //   投稿位置のタップを妨げるため、ここは false のままにすること。
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
      // ★スマホのズームの深さ。小さいほど深く寄れる（2026-07-20: 80→50）
      //   上げると霧も画面上で小さくなる。目安：
      //     50m … 霧の直径700px（上限に張り付く）
      //     80m … 652px ／ 100m … 522px ／ 150m … 348px
      //   ★上げるほど建物を特定しにくくなり、法的リスク対策は強まる★
      const MIN_CAMERA_DISTANCE_METERS_SP = 65;
      const isMobileInit = typeof window !== "undefined" && window.innerWidth < 768;
      map.cameraZoomRange = new window.mapkit.CameraZoomRange(
        isMobileInit ? MIN_CAMERA_DISTANCE_METERS_SP : MIN_CAMERA_DISTANCE_METERS_PC
      );


      // ============================================================
      // 🧱 新方式（タイル集計）の描き直し（2026-07-29 段階4）
      //
      // 【旧方式との違い】
      // 旧方式はブラウザに全件を持っているので即座に描けるが、
      // 新方式はサーバーへ問い合わせるので「待ち」が入る。
      //
      // 【古い返事で新しい表示を壊さないための番号札】
      // 素早くパンすると、問い合わせが複数同時に飛ぶ。通信は追い越しが
      // 起きるので、古い問い合わせの返事があとから届くことがある。
      // それをそのまま描くと、今見ている場所と違うマスが描かれる。
      // 要求ごとに番号を振り、最新の番号でなければ黙って捨てる。
      //
      // 【固まりバグとの関係】
      // 描き直しは今まで通り「指が止まって0.5秒後」にしか呼ばれない。
      // 通信の待ちがそこへさらに乗るので、地図の収束中に割り込む余地は
      // 旧方式より小さい。悪化する経路は無い（と考えているが、実機で
      // ピンチ連打の確認は必要）。
      // ============================================================
      let tileSeq = 0;
      // ★2026-07-29 固まりバグの修正★
      //
      // 【何が起きていたか】
      // 新方式の描き直しには通信の待ちがある（旧方式には無かった）。
      // 「操作が始まったら描き直しを取り消す」仕組みは入れてあるが、
      // すでに飛んでいる通信は取り消せない。その返事がパン・ズームの
      // 最中に届き、マーカーの入れ替えを行ってしまう。これは過去に
      // 何度も固まりの原因になった「収束中への割り込み」そのもの。
      // 近くに霧があるほど入れ替わるマーカーが増えるので、
      // 「霧がある場所で投稿すると起きる」という症状になっていた。
      //
      // 【対策】地図が動いている間は、届いた返事を捨てる。
      // 操作が終われば必ず描き直しが予約される（region-change-end →
      // 0.5秒後）ので、捨てても表示が古いままにはならない。
      let mapMoving = false;
      let mapMovingSince = 0;
      // ★2026-07-29 追加：この状態が解除されないまま残る場合への保険。
      //
      // 【起きていたこと】起動時、地図が最初の場所へ移動する際に
      // 「操作開始」は出るのに「操作終了」が出ないことがある。すると
      // 「動いている」判定が永久に解除されず、描き直しが全部止まり、
      // バッジが「読み込み中」のまま何も表示されない。画面を触ると
      // 操作終了が出て、そこで初めて表示される——という症状になる。
      //
      // 【なぜ時間で打ち切ってよいか】通信の追い越し対策は、操作開始の
      // たびに番号を進める仕組み（tileSeq）が本命で、こちらは二重の保険。
      // 一定時間を超えたら「合図が来なかった」とみなして解除しても、
      // 本命の守りは残る。
      const MOVING_STALE_MS = 2500;
      const isMapBusy = () =>
        mapMoving && Date.now() - mapMovingSince < MOVING_STALE_MS;
      const doRenderTiles = async (force = false) => {
        const seq = ++tileSeq;
        const currentZoom = calcSuperclusterZoom(map, mapContainerRef.current);
        const isCloudZoom = currentZoom >= CLOUD_ZOOM_THRESHOLD;
        const tileZ = calcTileZoom(map, mapContainerRef.current, isCloudZoom);

        // 期間フィルター（段階3）。全期間ならnullが渡る。
        const { rows, error } = await fetchTiles(
          map,
          tileZ,
          periodFromRef.current,
          isCloudZoom ? TILE_VIEWPORT_RATIO_FOG : TILE_VIEWPORT_RATIO_ICON
        );

        if (seq !== tileSeq) return; // 追い越された古い返事なので捨てる
        // ★通信中に地図が動き出していたら、ここで手を引く。
        //   動いている最中にマーカーを入れ替えると地図が固まる。
        //   ただし起動直後の1回目（force）は例外。まだ利用者は何も
        //   触っていないので、割り込みで固まる相手がいない。むしろ
        //   ここで止めると「合図が来ないまま何も表示されない」に陥る。
        if (!force && isMapBusy()) {
          setTileStatus("地図の操作中…");
          return;
        }
        // ★通信中に確認画面が開いた場合も描かない（閉じた時点で描き直す）
        if (justPostedActiveRef.current) return;
        if (cancelled || !mapRef.current) return;

        if (error || !rows) {
          setTileStatus(`取得失敗: ${error ?? "不明"}`);
          return;
        }
        const drawn = renderTileMarkers(
          map, markersRef, mapContainerRef.current, rows, currentZoom, tileZ
        );
        applyAnnotationInteractivity(markersRef, isSelectingRef, reportPosRef);
        // 「サーバーから来たマス数 → 画面にまとめた後の数」を出す。
        // 数が減っていれば、近いもの同士のまとめが効いている。
        setTileStatus(`z${tileZ} / ${rows.length}マス→${drawn}個`);
      };

      const doRender = () => {
        // ★新方式はここで完全に枝分かれする。以降は旧方式の処理を通らない。
        if (tileMode) {
          // ★2026-07-29：確認画面が開いている間は描き直さない。
          //   マーカーを入れ替えると吹き出しが選択解除されることがあり、
          //   それを開き直す処理が地図を動かし、また描き直しが走る、
          //   という循環に入りうる。閉じた時点で必ず描き直すので、
          //   投稿ぶんの霧が出ないままになることはない
          //   （justPosted の useEffect を参照）。
          if (justPostedActiveRef.current) return;
          void doRenderTiles();
          renderAdminPinsRef.current(map);
          loadFogAdjustAreas(map).then((updated) => {
            if (updated) void doRenderTiles();
          });
          return;
        }

        renderMarkers(map, markersRef, clusterIndexRef, mapContainerRef.current);
        applyAnnotationInteractivity(markersRef, isSelectingRef, reportPosRef);
        renderAdminPinsRef.current(map); // 管理者モード時のみ実際に描画される

        // 🌫️ 表示範囲が変わっていれば、その範囲の霧調整エリアを取り直す。
        //    中身が実際に変わったときだけ、もう一度だけ描き直す
        //    （updatedがtrueのときは範囲キャッシュが更新済みなので、
        //      次回は false が返り、無限ループにはならない）。
        loadFogAdjustAreas(map).then((updated) => {
          if (updated) {
            renderMarkers(map, markersRef, clusterIndexRef, mapContainerRef.current);
            applyAnnotationInteractivity(markersRef, isSelectingRef, reportPosRef);
          }
        });
      };
      requestRenderRef.current = doRender;

      // ============================================================
      // 🖐 描き直しのデバウンス（2026-07-22・固まりバグの根治・確定版）
      //
      // 【確定した真因】切り分けの結果、固まり/1本指ズームの原因は
      // 「ピンチの収束(慣性アニメーション)が終わる前に、霧の作り直し
      // (removeAnnotation→addAnnotations)が割り込むこと」と判明。
      // ・doRenderをゼロ回 → 出ない
      // ・220msで1回作り直す → 収束中に割り込み、出る
      // ・1000ms待って作り直す → 収束後なので割り込まず、出ない（実機確認）
      // ＝作り直す行為自体は無罪。収束中への割り込みだけが犯人。
      //
      // 【対策】指を離して地図が静止し、収束も終わってから作り直す。
      // SETTLE_MSは収束が確実に終わる最短を狙った値。短いと再発、長いと
      // 反応が鈍い。0.5秒は収束(約0.3〜0.5s)後で、体感も許容範囲。
      // 連続操作中はregion-change-endのたびにタイマーを張り直すので、
      // 作り直しは「手が完全に止まって収束も終わった後の1回」だけになる。
      //
      // 【副作用】操作中は霧が古いサイズのまま追従し、止めた瞬間に正しい
      // サイズ・クラスタに再計算される。これは意図した動作。
      // ============================================================
      const SETTLE_MS = 500;
      let settleTimer: ReturnType<typeof setTimeout> | null = null;

      // ============================================================
      // 🗺 エリアの形を線で描く（2026-07-22・管理者モード限定）
      //
      // 新しく範囲を設定するとき、既存のエリアと重ならないよう確認するため
      // の機能。「エリアを表示」がオンのときだけ、今見えている範囲の
      // 禁止エリア・調整エリアを線で描く。
      //
      // ・投稿禁止エリア＝赤の線／調整エリア＝オレンジの線
      // ・線は太め。塗りつぶしは薄くして、地図が読めるようにする
      // ・タッチには反応させない（地図の操作を妨げない・不具合の予防）
      // ・数は多くても数十本で、描き直す頻度も低いため動作は軽い
      // ・描き直しは AREA_SETTLE_MS(0.8秒) 静止してから1回だけ
      // ============================================================
      const AREA_SETTLE_MS = 800;
      let areaShapeTimer: ReturnType<typeof setTimeout> | null = null;

      const clearAreaShapes = () => {
        if (areaOverlaysRef.current.length > 0) {
          try {
            map.removeOverlays(areaOverlaysRef.current);
          } catch {
            /* すでに外れている場合は何もしない */
          }
          areaOverlaysRef.current = [];
        }
        if (areaLabelsRef.current.length > 0) {
          try {
            map.removeAnnotations(areaLabelsRef.current);
          } catch {
            /* すでに外れている場合は何もしない */
          }
          areaLabelsRef.current = [];
        }
      };

      const drawAreaShapes = async () => {
        // オフ、または管理者モードでなければ、描いてあるものを消して終了
        if (!showAreasRef.current) {
          clearAreaShapes();
          return;
        }
        try {
          const c = map.region.center;
          const s = map.region.span;
          const q =
            `?shapes=1` +
            `&minLat=${c.latitude - s.latitudeDelta / 2}` +
            `&minLng=${c.longitude - s.longitudeDelta / 2}` +
            `&maxLat=${c.latitude + s.latitudeDelta / 2}` +
            `&maxLng=${c.longitude + s.longitudeDelta / 2}`;
          const res = await fetch("/api/admin/area-lookup" + q, {
            headers: { "x-admin-key": adminKeyRef.current ?? "" },
          });
          if (!res.ok) return;
          const json = await res.json();
          const rows: any[] = json.areas ?? [];

          clearAreaShapes();
          const overlays: any[] = [];
          const labelAnnotations: any[] = [];

          rows.forEach((row) => {
            const g = row.geojson;
            if (!g) return;
            // Polygon と MultiPolygon の両方に対応
            const polys: any[] =
              g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];

            polys.forEach((rings: any[]) => {
              const points = (rings[0] ?? []).map(
                (c2: number[]) => new window.mapkit.Coordinate(c2[1], c2[0])
              );
              if (points.length < 3) return;

              const isBanned = row.kind === "banned";
              const overlay = new window.mapkit.PolygonOverlay([points], {
                style: new window.mapkit.Style({
                  strokeColor: isBanned ? "#D32F2F" : "#F9A825",
                  strokeOpacity: 1,
                  lineWidth: 4, // 太めにして見やすく
                  fillColor: isBanned ? "#D32F2F" : "#F9A825",
                  fillOpacity: 0.12, // 地図が読める程度の薄い塗り
                }),
              });
              // タッチに反応させない（地図操作の妨げ・不具合の予防）
              overlay.enabled = false;
              overlays.push(overlay);

              // 🔢 エリアの中央にID番号を出す。
              //    どのエリアかを一覧で探すときの手掛かりにする。
              //    種類は線の色で分かるので、番号だけを短く表示する。
              let sumLat = 0;
              let sumLng = 0;
              points.forEach((pt: any) => {
                sumLat += pt.latitude;
                sumLng += pt.longitude;
              });
              const center = new window.mapkit.Coordinate(
                sumLat / points.length,
                sumLng / points.length
              );
              const label = new window.mapkit.Annotation(
                center,
                () => {
                  const el = document.createElement("div");
                  el.textContent = String(row.id);
                  el.style.cssText =
                    "font:700 13px/1 system-ui,sans-serif;color:#FFFFFF;" +
                    "background:" + (isBanned ? "#D32F2F" : "#F9A825") + ";" +
                    "padding:3px 7px;border-radius:9px;white-space:nowrap;" +
                    "box-shadow:0 1px 3px rgba(0,0,0,0.3);pointer-events:none;" +
                    "user-select:none;-webkit-user-select:none;";
                  return el;
                },
                { anchorOffset: new DOMPoint(0, 0) }
              );
              label.enabled = false; // タッチに反応させない
              labelAnnotations.push(label);
            });
          });

          if (overlays.length > 0) {
            map.addOverlays(overlays);
            areaOverlaysRef.current = overlays;
          }
          if (labelAnnotations.length > 0) {
            map.addAnnotations(labelAnnotations);
            areaLabelsRef.current = labelAnnotations;
          }
        } catch {
          /* 失敗しても地図の表示自体には影響させない */
        }
      };

      drawAreaShapesRef.current = () => {
        if (areaShapeTimer) clearTimeout(areaShapeTimer);
        areaShapeTimer = setTimeout(drawAreaShapes, AREA_SETTLE_MS);
      };
      drawAreaShapesNowRef.current = drawAreaShapes;

      map.addEventListener("region-change-end", () => {
        mapMoving = false;
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          settleTimer = null;
          doRender();
          drawAreaShapesRef.current(); // エリアの線も追従させる
        }, SETTLE_MS);
      });
      // 次の操作が始まったら、予約中の作り直しは取り消す（操作中は作らない）
      map.addEventListener("region-change-start", () => {
        // ★新方式：すでに飛んでいる通信の返事も、ここで無効にする。
        //   番号を進めると、古い返事は seq の照合で捨てられる。
        mapMoving = true;
        mapMovingSince = Date.now();
        tileSeq++;
        if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
      });

      // 起動直後の1回目の描画。
      // ★新方式もここを通す。忘れると、地図を動かすまで何も表示されない。
      if (tileMode) {
        // ============================================================
        // ★2026-07-29：起動直後に何も表示されない問題への対策
        //
        // 【症状】サイトを開いた直後はアイコンが0個で、画面をどこか
        // 触ると出てくる。ウェルカム画面がある初回は正常に出る。
        //
        // 【原因（推定）】地図は作られた直後に指定の場所へ移動する。
        // その移動が「操作が始まった」と判定され、飛んでいた1回目の
        // 問い合わせが取り消される。移動が終われば描き直しが予約される
        // はずだが、起動時の移動では終了の合図が出ないことがあり、
        // 予約もされないまま何も描かれない状態で止まる。
        // ウェルカム画面がある場合は、その待ち時間で地図が落ち着くため
        // 1回目が成功する。症状の出方と一致する。
        //
        // 【対策】まだ1個も描けていない間だけ、少し待って描き直しを
        // 試みる。描けたら止まる。回数にも上限があるので、
        // 海の上など元々0個の場所を見ていても無限には繰り返さない。
        // ============================================================
        const ensureInitialTiles = (attempt: number) => {
          if (cancelled || !mapRef.current) return;
          if (markersRef.current.size > 0) return; // もう描けているので終了
          // ★force=true で呼ぶ。起動時は「操作終了」の合図が来ないまま
          //   「動いている」判定が残ることがあり、通常の経路だと
          //   何度試しても同じ判定で止められてしまうため。
          void doRenderTiles(true);
          renderAdminPinsRef.current(map);
          if (attempt < 7) {
            setTimeout(() => ensureInitialTiles(attempt + 1), 600);
          }
        };
        ensureInitialTiles(0);
      } else {
        renderMarkers(map, markersRef, clusterIndexRef, mapContainerRef.current);
        applyAnnotationInteractivity(markersRef, isSelectingRef, reportPosRef);
        renderAdminPinsRef.current(map);
      }

      // 🌫️ 起動直後にも調整エリアを1回読み込む（以後はdoRender内で範囲追従）
      loadFogAdjustAreas(map).then((updated) => {
        if (updated && !cancelled && mapRef.current) doRender();
      });

      map.addEventListener("single-tap", async (event: any) => {
        // ============================================================
        // 🪳 円(🪳+数字)のタップ展開ズーム（2026-07-20 自前判定に変更）
        //
        // 全マーカーを触覚ゼロにしたため、アノテーションのselectは
        // もう発火しない。代わりに、地図が受けたタップの画面座標と、
        // 各円の画面上の中心・半径を比べて「円が押されたか」を判定する。
        // 通常閲覧中（投稿フロー外）のみ。
        // ============================================================
        if (!isSelectingRef.current && !reportPosRef.current) {
          const tapPt = event.pointOnPage;


          // 📍管理者ピンのタップ判定（ピンも触覚ゼロ化したため自前判定。
          // 　視覚的に最前面なので、円より先に判定する）
          for (const pin of adminPinsRef.current) {
            const h = (pin as any)?.__adminHit;
            if (!h) continue;
            try {
              const p = map.convertCoordinateToPointOnPage(
                new window.mapkit.Coordinate(h.lat, h.lng)
              );
              if (Math.hypot(tapPt.x - p.x, tapPt.y - p.y) <= h.radiusPx) {
                pin.selected = true; // プログラム側から選択→吹き出し(削除ボタン)が開く
                return;
              }
            } catch {
              /* 座標変換に失敗したピンはスキップ */
            }
          }

          return; // 投稿フロー外の通常タップは、円=標準select・他=無反応
        }

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
      containerEl.removeEventListener("click", guardMapInput, true);
      containerEl.removeEventListener("pointerdown", guardMapInput, true);
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

    // ★2026-07-29：新方式ではsuperclusterを一切使わない。
    //   ここを素通ししないと、空のクラスタ木で renderMarkers が走り、
    //   新方式が描いたマーカーを全部消してしまう。
    if (tileMode) return;

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
    // reports（投稿データ）が変わったら、クラスタ木を作り直して1回描画する。
    // これはユーザー操作中ではないので即描画でよい（デバウンス対象は
    // region-changeによる連続再描画のみ）。
    renderMarkers(mapRef.current, markersRef, clusterIndexRef, mapContainerRef.current);
    applyAnnotationInteractivity(markersRef, isSelectingRef, reportPosRef);
  }, [reports]);

  // 🗓 期間を切り替えたら、その範囲で集計を取り直して描き直す
  useEffect(() => {
    if (tileMode) requestRenderRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  // isSelecting・reportPosが変化した瞬間にも、既存の霧アノテーションの
  // タップ吸収状態を即座に切り替える（renderMarkersの再実行を待たない）
  useEffect(() => {
    applyAnnotationInteractivity(markersRef, isSelectingRef, reportPosRef);
  }, [isSelecting, reportPos]);

  // 🪳画像のロードが完了したタイミングで、既に絵文字版で描画済みの
  // マーカーを画像版に描き直す（clusterIconCacheは上のuseEffectで既にクリア済み）
  useEffect(() => {
    if (!roachImageReady || !mapRef.current) return;
    // ★2026-07-29 差分更新化に伴う注意★
    // 絵文字→画像への描き直しは「見た目だけ」の変更で、差分更新の名札が
    // 変わらない(＝そのまま使い回されて絵文字のまま残ってしまう)。
    // ここだけは例外として、全マーカーを捨ててから描き直す。
    if (markersRef.current.size > 0) {
      mapRef.current.removeAnnotations(Array.from(markersRef.current.values()));
      markersRef.current = new Map();
    }
    // 新方式は描き直しの入口（doRender）を通す。旧方式は従来通り。
    if (tileMode) {
      requestRenderRef.current();
      return;
    }
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
  //
  // ============================================================
  // ★2026-07-29 固まりバグの修正（本人の切り分けにより判明）★
  //
  // 【症状】投稿後、地図をタップして吹き出しを閉じ、🪳を押して開き直す、
  // を繰り返してからピンチすると、地図が固まる（例の症状）。
  //
  // 【原因】この確認ピンだけが「タッチに反応する物体」として残っていた。
  // 霧・🪳アイコン・📍管理者ピンは、過去の対策ですべてタッチ不感に
  // してあるが、ここだけ対策から漏れていた。タッチに反応する物体の上で
  // ピンチすると、MapKit内部のタッチ管理が壊れる（既知の真因）。
  //
  // 【対策】確認ピンが出ている間は、次の3つで発生経路そのものを塞ぐ。
  //   ① ズームを禁止する（＝ピンチが起きない。パンは今まで通りできる）
  //   ② 地図をタップしても吹き出しを閉じない（＝開閉の繰り返しが起きない）
  //   ③ 🪳アイコンをタッチ不感にする（＝反応する物体が存在しなくなる）
  // 吹き出しは「投稿を取り消す」「閉じる」を押したときだけ閉じる。
  // ============================================================
  useEffect(() => {
    const currentMap = mapRef.current;
    if (!currentMap) return;

    // 既存の確認ピンがあれば消す
    if (justPostedMarkerRef.current) {
      currentMap.removeAnnotation(justPostedMarkerRef.current);
      justPostedMarkerRef.current = null;
    }

    justPostedActiveRef.current = !!justPosted;

    if (!justPosted) {
      applyZoomLock(); // 確認画面が消えたので、他に止める理由が無ければ戻る
      // ★2026-07-29 新方式：確認画面が開いている間は描き直しを止めている
      //   （doRender を参照）。閉じたこの瞬間に、投稿ぶんを含めて描き直す。
      if (tileMode) requestRenderRef.current();
      return;
    }

    applyZoomLock(); // ①ズーム禁止。ピンチが発生しないので、固まりの起点が消える。

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
        // ③タッチ不感にする（📍管理者ピン・🪳アイコンと同じ方針）。
        //   吹き出しは開きっぱなしなので、押して開き直す必要がない。
        div.style.pointerEvents = "none";
        div.style.userSelect = "none";
        (div.style as any).webkitUserSelect = "none";
        (div.style as any).webkitTouchCallout = "none";

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

    // ②「閉じる」「取り消す」を押すまで、吹き出しを閉じさせない。
    //   dismissed が立つまでは、閉じられても開き直す。
    let dismissed = false;
    annotation.addEventListener("deselect", () => {
      if (dismissed) return;
      // MapKitの選択解除処理の直後に開き直す（同じ処理の途中で
      // 選択し直すと競合するため、いったん処理を譲ってから行う）
      setTimeout(() => {
        try {
          if (!dismissed && justPostedMarkerRef.current === annotation) {
            annotation.selected = true;
          }
        } catch {
          /* すでに地図から外れている場合は何もしない */
        }
      }, 0);
    });

    annotation.callout = {
      calloutElementForAnnotation: () =>
        buildJustPostedCallout(
          justPosted,
          () => {
            dismissed = true; // 以後は閉じてよい
            if (onDismissJustPostedRef.current) onDismissJustPostedRef.current();
          },
          () => {
            dismissed = true;
            if (onJustPostedDeletedRef.current) onJustPostedDeletedRef.current();
          }
        ),
    };

    currentMap.addAnnotation(annotation);
    // 吹き出しを最初から開いた状態にする（投稿できたことが一目で分かるように）
    currentMap.selectedAnnotation = annotation;
    justPostedMarkerRef.current = annotation;

    // このピンが消されるとき（再投稿・離脱など）は、開き直しを止める
    return () => {
      dismissed = true;
    };
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
      applyZoomLock();
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
          // ★2026-07-19:吹き出しを🪳の真上・中央に出す（以前の(-10.5,17)は
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
            "position:relative;background:#FFFFFF;border-radius:12px;padding:12px 14px;box-shadow:0 4px 16px rgba(0,0,0,0.18);text-align:center;min-width:210px;" +
            // ★2026-07-29：案内文には既に指定していたが、箱全体には
            //   掛かっておらず、ボタンの文字が選択できる状態だった。
            //   ここはドラッグ操作をする箱なので、選択が入ると特に邪魔になる。
            "user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;";

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
      // ★2026-07-29：止める条件の判断は applyZoomLock に一本化した。
      //   ここで個別に条件を書くと、また取り合いが起きる。
      applyZoomLock();
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
      {/* ============================================================
          🔝 上段の帯（2026-07-30 統一）
          絞り込み・住所検索・現在地の3つを、同じ高さで横一列に並べる。
          ・端からの距離は UI.edge、高さは UI.rowH、間隔は UI.gap。
            この3つを変えれば全体が揃って動く。
          ・検索バーは残り幅いっぱいに伸びる（SearchBar.tsx 側で flex:1）。
          ・投稿の流れに入っている間は、帯ごと隠す。
         ============================================================ */}
      {!inReportFlow && (
        <div
          style={{
            position: "absolute",
            top: UI.edge,
            left: UI.edge,
            right: UI.edge,
            height: UI.rowH,
            display: "flex",
            alignItems: "center",
            gap: UI.gap,
            zIndex: 1000,
          }}
        >
          {/* 🗓 期間フィルター。パネルはこの帯の下に開くので、
              検索バーとぶつからない。 */}
          {tileMode && (
            <div style={{ position: "relative", flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setFilterOpen((v) => !v)}
                aria-label="期間で絞り込む"
                title="期間で絞り込む"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  height: UI.rowH,
                  // ★全期間（初期状態）のときは、現在地ボタンと同じ
                  //   ぴったりの丸にする。両端に同じ大きさの丸が並ぶ。
                  //   期間を絞っているときだけ、横に伸びて文字が出る。
                  ...(period === "all"
                    ? { width: UI.rowH, padding: 0 }
                    : { padding: "0 14px" }),
                  background: "#ffffff",
                  border: "none",
                  borderRadius: UI.rowH / 2,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#292524",
                  lineHeight: 1,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="#888" strokeWidth="2"
                  strokeLinecap="round" style={{ display: "block", flexShrink: 0 }}>
                  {/* 設定つまみ（スライダー）の形 */}
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                  <circle cx="8" cy="6" r="2.5" fill="#fff" />
                  <circle cx="15" cy="12" r="2.5" fill="#fff" />
                  <circle cx="10" cy="18" r="2.5" fill="#fff" />
                </svg>
                {/* ★初期状態（全期間）では文字を出さない。書かなくても
                    分かるものを書くと、両端の丸の対称が崩れるため。
                    スマホ・PCとも同じ規則にしてある。 */}
                {period !== "all" && <span>{PERIOD_LABELS[period]}</span>}
              </button>

              {/* 開いたパネル。帯の下に出る */}
              {filterOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: UI.rowH + UI.gap,
                    left: 0,
                    background: "#ffffff",
                    borderRadius: 12,
                    boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                    padding: "12px 14px",
                    minWidth: 168,
                    zIndex: 1001,
                  }}
                >
                  <div style={{
                    display: "flex", alignItems: "center",
                    justifyContent: "space-between", gap: 10, marginBottom: 8,
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#78716C" }}>期間</span>
                    <button
                      type="button"
                      onClick={() => setFilterOpen(false)}
                      aria-label="閉じる"
                      style={{
                        border: "none", background: "transparent", cursor: "pointer",
                        color: "#78716C", fontSize: 16, lineHeight: 1, padding: 0,
                      }}
                    >×</button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {(["all", "1y", "3m"] as PeriodMode[]).map((m) => {
                      const active = period === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setPeriod(m)}
                          style={{
                            textAlign: "left",
                            background: active ? "#662510" : "transparent",
                            color: active ? "#FFFFFF" : "#292524",
                            border: active ? "none" : "1px solid #E7E5E4",
                            borderRadius: 8,
                            padding: "8px 12px",
                            cursor: "pointer",
                            fontSize: 13,
                            fontWeight: 600,
                            lineHeight: 1.2,
                          }}
                        >
                          {PERIOD_LABELS[m]}
                        </button>
                      );
                    })}
                  </div>

                  {/* 選んだ結果を日付で示す。選択肢の箱と同じ幅・同じ
                      左右余白にして、中央に置く。毎月1日に自動で変わる。
                      ★薄すぎたので色を濃くした（#78716C → #57534E）★ */}
                  <div style={{
                    marginTop: 8,
                    padding: "6px 12px",
                    background: "#F5F5F4",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#57534E",
                    lineHeight: 1.4,
                    textAlign: "center",
                    whiteSpace: "nowrap",
                  }}>
                    {periodFrom ? `${periodFrom.replace(/-/g, "/")}〜現在` : "すべての投稿"}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 🔍 住所検索バー。
              PCでは伸びすぎるので UI.searchMax で上限をつけ、
              左右のボタンの間で中央に置く。スマホは上限を実質無しに
              してあるので、今まで通り幅いっぱいに広がる。 */}
          <div style={{
            flex: 1, minWidth: 0, display: "flex", justifyContent: "center",
          }}>
            <SearchBar
              onSearch={handleSearch}
              height={UI.rowH}
              maxWidth={UI.searchMax}
            />
          </div>

          {/* 📍 現在地ボタン */}
          <button
            type="button"
            onClick={handleLocate}
            aria-label="現在地を表示"
            title="現在地を表示"
            style={{
              flexShrink: 0,
              width: UI.rowH,
              height: UI.rowH,
              borderRadius: "50%",
              background: "#ffffff",
              border: "none",
              boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              padding: 0,
              opacity: locating ? 0.6 : 1,
            }}
          >
            {/* ★色は SearchBar.tsx の虫眼鏡と同じ "#888" に揃えてある */}
            <svg
              width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="#888" strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round"
              style={{ display: "block" }}
            >
              {/* ★切れ込みの深さは3つ目の座標(11.2 12.8)で決まる。
                  先端(21,3)に近づけるほど深く鋭くなる。 */}
              <path d="M21 3L3 10.8l8.2 2L13.2 21z" />
            </svg>
          </button>
        </div>
      )}

      {/* 現在地が取得できなかったときの案内（4秒で自動的に消える） */}
      {locateError && (
        <div
          style={{
            position: "absolute",
            top: 60,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(255,255,255,0.95)",
            color: "#292524",
            padding: "10px 20px",
            borderRadius: 24,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
            zIndex: 1000,
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {locateError}
        </div>
      )}

      {/*
        🎨 目撃件数の凡例（PC=右上・従来サイズ／スマホ=左下・やや小さめ）
        位置・サイズの微調整は、コンポーネント上部の LEGEND_PC / LEGEND_SP で行う。
      */}
      <div
        style={{
          position: "absolute",
          // ★2026-07-30：PC・スマホとも左下に統一。
          //   下端は page.tsx のGボタンと同じ UI.bottom なので揃う。
          //   左右の端は UI.edge なので、他の部品とも揃う。
          bottom: UI.bottom,
          left: UI.edge,
          background: "white",
          borderRadius: isMobile ? LEGEND_SP.radius : LEGEND_PC.radius,
          // ★2026-07-30：上下の余白で高さを合わせる方式をやめた。
          //   文字の行の高さに左右されて、Gボタンの箱と揃わなかったため。
          //   見出しの行の高さを UI_BOX_H に固定する方式に変更（下を参照）。
          //   左右の余白だけをここで持ち、開いたときは下側にも余白を足す。
          // ★開いているときの上の余白（8）で、「目撃件数」と箱の上端の
          //   間隔を決めている。閉じたときは見出しの行が52pxあり、その中で
          //   上下中央に置かれるので、余白は0でちょうどよくなる。
          //   ★上が詰まって見えたらこの 8 を大きくする★
          padding: legendCollapsed ? "0 18px" : "8px 18px 14px",
          boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
          fontSize: isMobile ? LEGEND_SP.font : LEGEND_PC.font,
          color: "#292524",
          zIndex: 10,
          lineHeight: isMobile ? LEGEND_SP.line : LEGEND_PC.line,
          userSelect: "none",
        }}
      >
        {/* ★2026-07-30：見出しの行ぜんぶを押せるようにした。
            以前は小さな▼だけが当たり判定で、押しにくく反応も悪かった。
            上下に余白(padding)を入れて指が当たる面積も広げてある。
            ★押しにくいと感じたら padding の 6px を大きくする★ */}
        <div
          onClick={() => setLegendCollapsed((v) => !v)}
          role="button"
          aria-label={legendCollapsed ? "凡例を開く" : "凡例を閉じる"}
          style={{
            display: "flex",
            alignItems: "center",
            // ★閉じているときは中央寄せ。開いているときは色見本が下に
            //   続くので、見出し左・矢印右のほうが読みやすい。
            justifyContent: legendCollapsed ? "center" : "space-between",
            gap: 8,
            // ★閉じているときは UI_BOX_H に固定する。これでGボタンの箱と
            //   必ず同じ高さになり、中の文字も同じ高さに並ぶ。
            //   行全体が押せるので、当たり判定も52px分ある。
            //   ★開いているときは低くする。閉じたときの高さのままだと、
            //     見出しと1つ目の色見本の間が空きすぎるため。
            //     ここを大きくすると間隔が広がる。
            height: legendCollapsed
              ? UI_BOX_H
              : (isMobile ? LEGEND_SP.openHeadH : LEGEND_PC.openHeadH),
            cursor: "pointer",
          }}
        >
          <span
            style={{
              fontSize: isMobile ? LEGEND_SP.font : LEGEND_PC.font,
              color: LEGEND_HEAD_COLOR,
              fontWeight: 500,
              lineHeight: 1.2,
            }}
          >
            目撃件数
          </span>
          {/* ★2026-07-30：矢印を文字(▸)から図形(SVG)に変えた。
              文字の三角は、書体によって上下の位置が微妙にずれる。
              図形なら必ず真ん中に来る。押す判定は行ぜんぶが持っている。
              閉じているとき＝右向き、開いているとき＝下向き。 */}
          <svg
            width="11" height="11" viewBox="0 0 24 24"
            fill={LEGEND_HEAD_COLOR}
            style={{
              display: "block",
              flexShrink: 0,
              transform: legendCollapsed ? "none" : "rotate(90deg)",
            }}
          >
            <path d="M8 4l10 8-10 8z" />
          </svg>
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
              <span style={{ fontSize: isMobile ? LEGEND_SP.bodyFont : LEGEND_PC.bodyFont }}>
                {bucket.label}
              </span>
            </div>
          ))}
      </div>

      {/* 絞り込みが開いている間、画面全体に透明な受け皿を置く。
          どこを触っても閉じる。地図には触らないので、閉じるつもりの
          タップで地図が動いてしまうこともない。
          ★上段の帯(zIndex 1000)より下、地図より上に置いている。 */}
      {tileMode && !inReportFlow && filterOpen && (
        <div
          onClick={() => setFilterOpen(false)}
          style={{ position: "absolute", inset: 0, zIndex: 999 }}
        />
      )}

      <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />

      {/* ============================================================
          🧱 新方式（?mode=tile）で見ていることを示す表示。
          どちらを見ているのか分からなくなるのを防ぐためのもの。
          使うマスの段階と件数も出しているので、粒の粗さを調整する
          （TILE_TARGET_PX）ときの手掛かりになる。
          ★新方式が正式採用になったら、このバッジごと削除すること★
         ============================================================ */}
      {tileDebug && (
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: "50%",
            transform: "translateX(-50%)",
            background: tileStatus.startsWith("取得失敗")
              ? "rgba(179, 38, 30, 0.92)"
              : "rgba(102, 37, 16, 0.88)",
            color: "#fff",
            padding: "5px 12px",
            borderRadius: 14,
            fontSize: 11,
            fontWeight: 600,
            zIndex: 1000,
            pointerEvents: "none",
            whiteSpace: "nowrap",
            maxWidth: "90%",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          新方式（タイル）{tileStatus ? ` ${tileStatus}` : " 読み込み中"}
        </div>
      )}

    </div>
  );
});

export default AppleMap;
