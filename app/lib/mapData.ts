// ============================================================
// app/lib/mapData.ts
//
// 地図に描くデータを「画面に映っている範囲のぶんだけ」取ってくる。
//
// 【なぜ必要か】
// 従来の fetchReports は、全投稿をブラウザへ配っていた。投稿が数十万件を
// 超えると、転送量とメモリの両方で破綻する（メモ 10-3 の課題）。
// このモジュールは /api/map-data を通して、
//   ・ズームが浅いとき … 区画（タイル）ごとの集計だけ
//   ・ズームが深いとき … 画面内の個別の投稿だけ
// を受け取る。総件数が何百万件でも、受け取る量は画面の広さで決まる。
//
// 【描画側を変えずに済ませる工夫】
// 集計（タイル）も個別（投稿）も、同じ Report の形に揃えて返す。
// タイルの場合だけ weight（その区画の件数）を持たせてある。
// 描画側は「weight があればその数、無ければ1件」と見るだけでよく、
// クラスタリング・霧の描き方・タッチまわりの作りは一切変えなくて済む。
//
// ★ここは取得だけを担当する。描画やタイミング制御は AppleMap.tsx 側の
//   既存の仕組み（SETTLE_MS のデバウンス）にそのまま乗せること。
//   ピンチの収束中に描き直すと地図が固まる不具合があったため、
//   取得が終わっても勝手に描き直さない設計にしてある。
// ============================================================

export interface MapPoint {
  id: number;
  lat: number;
  lng: number;
  nearby_count?: number;
  /** 区画の集計を表す点のときだけ入る。その区画に含まれる投稿数 */
  weight?: number;
}

export interface MapDataResult {
  /** "tiles"＝区画の集計 ／ "reports"＝個別の投稿 */
  mode: "tiles" | "reports";
  points: MapPoint[];
  /** 個別モードで上限に達した（画面内に表示しきれていない）とき true */
  truncated?: boolean;
}

/**
 * 地図の表示範囲から、描画に必要な点を取得する。
 *
 * @param map        MapKit の Map インスタンス
 * @param zoom       supercluster と同じ基準で求めたズーム値
 * @param period     "all" | "1y" | "3m"（将来の絞り込み用。既定は全期間）
 */
export async function fetchMapData(
  map: any,
  zoom: number,
  period: "all" | "1y" | "3m" = "all"
): Promise<MapDataResult | null> {
  try {
    const c = map.region.center;
    const s = map.region.span;

    // 画面より少し広めに取る。地図を少し動かしただけで端が欠けて見えるのを
    // 防ぐため。広げすぎると転送量が増えるので、片側25%ずつに留める。
    const padLat = s.latitudeDelta * 0.25;
    const padLng = s.longitudeDelta * 0.25;

    const minLat = c.latitude - s.latitudeDelta / 2 - padLat;
    const maxLat = c.latitude + s.latitudeDelta / 2 + padLat;
    const minLng = c.longitude - s.longitudeDelta / 2 - padLng;
    const maxLng = c.longitude + s.longitudeDelta / 2 + padLng;

    const q =
      `?minLat=${minLat}&minLng=${minLng}` +
      `&maxLat=${maxLat}&maxLng=${maxLng}` +
      `&zoom=${zoom}&period=${period}`;

    const res = await fetch("/api/map-data" + q);
    if (!res.ok) return null;
    const json = await res.json();

    // ---- 個別の投稿が返ってきた場合（ズームが深い＝霧モード）----
    if (json.mode === "reports") {
      return {
        mode: "reports",
        truncated: json.truncated === true,
        points: (json.reports ?? []).map((r: any) => ({
          id: r.id,
          lat: r.lat,
          lng: r.lng,
          nearby_count: r.nearby_count ?? 1,
          // 個別の投稿は1件ぶん。weight を持たせないことで、
          // 描画側は従来どおり「1件」として扱う。
        })),
      };
    }

    // ---- 区画の集計が返ってきた場合（ズームが浅い＝俯瞰）----
    // 1区画を1つの点として扱い、weight にその区画の件数を入れる。
    // 座標は区画内の投稿の平均位置なので、格子状には並ばず、
    // 都市部に自然にばらけて見える（従来の見た目とほぼ同じ）。
    return {
      mode: "tiles",
      points: (json.tiles ?? []).map((t: any) => ({
        // 区画を一意に表すIDを組み立てる（描画側で使うことはないが、
        // Reactのkeyやデバッグのために一意にしておく）
        id: Number(`${t.x}${t.y}`.slice(0, 15)) || 0,
        lat: t.lat,
        lng: t.lng,
        // 色は区画内の nearby_count の最大値。
        // ブラウザ側で最大値を持ち回っていた従来の処理と同じ結果になる。
        nearby_count: t.max_near ?? 1,
        weight: t.cnt ?? 1,
      })),
    };
  } catch {
    // 通信失敗時は null を返し、呼び出し側で「前回の表示を保つ」判断をする
    return null;
  }
}