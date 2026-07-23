"use client";

// app/admin/page.tsx
//
// ============================================================
// 管理画面（2026-07-19 新設）
//
// URL: /admin （リンクはどこにも張らない。URLを知っていても
// 合言葉(ADMIN_SECRET)が無ければ何も見られない・できない）
//
// 【タブ1：投稿チェック】
//   最新200件の投稿を、運営箱の住所・詳細ごと一覧表示。
//   ・「未チェックのみ」絞り込み ＋ チェック済みフラグの切替
//   ・投稿の削除（削除依頼への対応・イタズラ削除。2段階確認）
//   ・「この地点を禁止エリア化」＝指定半径の円形エリアを即登録
//     （イタズラ投稿を見つけたら、削除＋再発防止をこの画面で完結できる）
//
// 【タブ2：禁止エリア】
//   登録済みエリアの一覧・削除。
//   geojson.ioで描いたポリゴン(GeoJSON)の貼り付け登録。
//   《geojson.ioの使い方》
//     1. https://geojson.io をブラウザで開く
//     2. 地図上でポリゴンツール（五角形アイコン）を選び、囲みたい範囲の
//        頂点を順にクリックし、最初の点をクリックして閉じる
//     3. 右側に出るJSON全文をコピーして、この画面の欄に貼り付けて登録
//
// 合言葉はlocalStorageに保持（★2026-07-19変更：メイン地図の管理者モードと
// 合言葉を共有するため。sessionStorageはタブごとに独立で共有できない）。
// タブを閉じても残るので、共用PCでは必ず「ログアウト」を押すこと。
// ============================================================

import { useEffect, useRef, useState } from "react";

const BRAND = "#662510";
const TEXT = "#292524";
const SUB = "#78716C";

interface AdminReport {
  id: number;
  created_at: string;
  occurred_on: string | null;
  lat: number;
  lng: number;
  nearby_count: number;
  checked: boolean;
  hidden?: boolean; // 🟡 霧だけ非表示（投稿データは残す）
  report_details: { address: string | null; detail: string | null } | null;
}

interface ExcludedArea {
  id: number;
  name: string;
  reason: string | null;
  created_at: string;
}

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<"reports" | "areas">("reports");
  const [message, setMessage] = useState("");

  // ---- タブ1：投稿チェック用 ----
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [uncheckedOnly, setUncheckedOnly] = useState(false);
  // 「霧を非表示にした投稿」だけを一覧するフィルタ
  const [hiddenOnlyFilter, setHiddenOnlyFilter] = useState(false);
  const [radiusM, setRadiusM] = useState(30); // 禁止エリア化の半径(m)
  const [armedDeleteId, setArmedDeleteId] = useState<number | null>(null); // 2段階削除

  // ---- タブ2：禁止エリア用 ----
  const [areas, setAreas] = useState<ExcludedArea[]>([]);
  const [areaName, setAreaName] = useState("");
  const [areaReason, setAreaReason] = useState("");
  const [areaGeojson, setAreaGeojson] = useState("");
  const [armedPurgeId, setArmedPurgeId] = useState<number | null>(null); // 一括削除の2段階確認

  // ============================================================
  // 🗺 地図でポリゴンを描くツール用（2026-07-19 追加）
  // 建物の角を順にタップ → 3点以上で面が表示 → 「この形で登録」
  // ============================================================
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const adminMapRef = useRef<any>(null);
  const vertexAnnotationsRef = useRef<any[]>([]);
  const polygonOverlayRef = useRef<any>(null);
  const hoverLineRef = useRef<any>(null); // ④マウスに追従する「びよーん」線
  const drawPointsRef = useRef<{ lat: number; lng: number }[]>([]); // mousemoveハンドラ用の最新値
  const [drawPoints, setDrawPoints] = useState<{ lat: number; lng: number }[]>([]);
  // ★2026-07-19 描画改良：輪を閉じたかどうか。
  // false＝頂点を打っている最中（実線が伸びていくだけ。面はまだ作らない）
  // true ＝始点をクリックして輪が閉じた状態（面が表示され、登録できる）
  const [drawClosed, setDrawClosed] = useState(false);
  const drawClosedRef = useRef(false);
  const [satellite, setSatellite] = useState(false); // 航空写真モード（通常は標準地図。必要時のみ切替）
  const [jumpQuery, setJumpQuery] = useState("");

  // 地図の初期化（禁止エリアタブを開いたときだけ動かす）
  useEffect(() => {
    if (!authed || tab !== "areas") return;
    let cancelled = false;

    const setup = () => {
      if (cancelled || !mapDivRef.current || adminMapRef.current) return;
      const mk = (window as any).mapkit;

      // メインの地図と同じ初期化ガードを共有（二重initを防ぐ）
      if (!(window as any).__mapkitInitialized) {
        mk.init({
          authorizationCallback: (done: (token: string) => void) => {
            fetch("/api/mapkit-token").then((r) => r.text()).then(done);
          },
        });
        (window as any).__mapkitInitialized = true;
      }

      const map = new mk.Map(mapDivRef.current, {
        region: new mk.CoordinateRegion(
          new mk.Coordinate(35.681236, 139.767125),
          new mk.CoordinateSpan(0.02, 0.02)
        ),
        isRotationEnabled: false,
        showsCompass: "hidden",
      });
      // 地図モードは satellite state の useEffect が反映する（デフォルトは標準地図）

      // ============================================================
      // ★建物を正確に囲うため、管理画面の地図だけ限界までズーム解禁。
      // 一般ユーザー向けの法的ズーム制限は、運営の作図作業には不要。
      // ============================================================
      map.cameraZoomRange = new mk.CameraZoomRange(15);

      // ============================================================
      // タップで頂点を追加（2026-07-19 描画改良版）
      //
      // Excelのフリーハンド図形と同じ挙動：
      //   ・頂点を打つたびに、確定した実線がつながっていく（面はまだ出ない）
      //   ・3点以上ある状態で「始点（少し大きい印）」をクリックすると、
      //     輪が閉じて面が表示され、確定状態になる
      //   ・閉じた後は頂点を追加できない（「やり直し」で最初から）
      //
      // 始点クリックの判定は「画面上のピクセル距離」で行う。緯度経度の
      // 距離だとズームによって当たり判定の広さが変わってしまうため、
      // 画面座標に変換してから比較する（常に押しやすい約18pxで固定）。
      // ============================================================
      const CLOSE_HIT_RADIUS_PX = 18;

      map.addEventListener("single-tap", (event: any) => {
        if (drawClosedRef.current) return; // 閉じた後は頂点を打たない

        const pts = drawPointsRef.current;
        const tapPoint = event.pointOnPage;

        // 3点以上あるとき、始点の近くをタップしたら「閉じる」
        if (pts.length >= 3) {
          try {
            const firstOnPage = map.convertCoordinateToPointOnPage(
              new mk.Coordinate(pts[0].lat, pts[0].lng)
            );
            const dx = tapPoint.x - firstOnPage.x;
            const dy = tapPoint.y - firstOnPage.y;
            if (Math.hypot(dx, dy) <= CLOSE_HIT_RADIUS_PX) {
              setDrawClosed(true);
              return;
            }
          } catch {
            /* 座標変換に失敗したら通常の頂点追加として続行 */
          }
        }

        const c = map.convertPointOnPageToCoordinate(tapPoint);
        setDrawPoints((prev) => [...prev, { lat: c.latitude, lng: c.longitude }]);
      });

      // ============================================================
      // ④「びよーん」線（ラバーバンド・2026-07-19追加）
      // Excelの図形描画のように、最後に打った頂点からマウスの現在位置まで
      // 点線を伸ばして追従させる。2点以上あるときは、最初の点への
      // 「閉じる線」も一緒に見せる（囲い終わりの形が事前に分かる）。
      // ============================================================
      const removeHoverLine = () => {
        if (hoverLineRef.current) {
          map.removeOverlay(hoverLineRef.current);
          hoverLineRef.current = null;
        }
      };
      const onMouseMove = (e: MouseEvent) => {
        const pts = drawPointsRef.current;
        // 頂点が無い・輪を閉じた後は、びよーん線を出さない
        if (pts.length === 0 || drawClosedRef.current) {
          removeHoverLine();
          return;
        }
        try {
          const cursor = map.convertPointOnPageToCoordinate(new DOMPoint(e.pageX, e.pageY));
          const last = pts[pts.length - 1];
          // ★2026-07-19 描画改良：追従するのは最後の頂点からの1本だけ。
          // （以前は始点への「閉じる線」も出していたが、三角形に見えて
          //   紛らわしいとの指摘で廃止。閉じるのは始点クリックで明示的に行う）
          const coords = [new mk.Coordinate(last.lat, last.lng), cursor];
          if (!hoverLineRef.current) {
            hoverLineRef.current = new mk.PolylineOverlay(coords, {
              style: new mk.Style({
                strokeColor: "#662510",
                lineWidth: 2,
                lineDash: [6, 4], // 点線＝まだ確定していない線、の意味
              }),
              enabled: false,
            });
            map.addOverlay(hoverLineRef.current);
          } else {
            hoverLineRef.current.points = coords;
          }
        } catch {
          /* 地図の描画途中で座標変換に失敗することがあるが、次のmoveで復帰するので無視 */
        }
      };
      mapDivRef.current.addEventListener("mousemove", onMouseMove);
      mapDivRef.current.addEventListener("mouseleave", removeHoverLine);

      adminMapRef.current = map;
    };

    // mapkitスクリプトが未ロードなら読み込む（管理画面はメイン地図を経由しないため）
    const ensureScript = () => {
      if ((window as any).mapkit) {
        setup();
        return;
      }
      if (!document.getElementById("mapkit-script")) {
        const s = document.createElement("script");
        s.id = "mapkit-script";
        s.src = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";
        document.head.appendChild(s);
      }
      const wait = () => {
        if (cancelled) return;
        if ((window as any).mapkit) setup();
        else setTimeout(wait, 100);
      };
      wait();
    };
    ensureScript();

    return () => {
      cancelled = true;
      if (adminMapRef.current) {
        adminMapRef.current.destroy();
        adminMapRef.current = null;
      }
      vertexAnnotationsRef.current = [];
      polygonOverlayRef.current = null;
      hoverLineRef.current = null;
      setDrawPoints([]);
      setDrawClosed(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, tab]);

  // 航空写真⇔通常地図の切替
  useEffect(() => {
    const map = adminMapRef.current;
    const mk = (window as any).mapkit;
    if (!map || !mk) return;
    map.mapType = satellite ? mk.Map.MapTypes.Hybrid : mk.Map.MapTypes.Standard;
  }, [satellite]);

  // 頂点・閉じ状態が変わるたびに、頂点マーカー・確定線・面を描き直す
  useEffect(() => {
    drawPointsRef.current = drawPoints; // mousemoveハンドラ用に最新値を同期
    drawClosedRef.current = drawClosed;
    const map = adminMapRef.current;
    const mk = (window as any).mapkit;
    if (!map || !mk) return;

    // 頂点が全消し（やり直し）されたら、びよーん線も消す
    if (drawPoints.length === 0 && hoverLineRef.current) {
      map.removeOverlay(hoverLineRef.current);
      hoverLineRef.current = null;
    }
    // 輪を閉じた瞬間も、びよーん線を消す
    if (drawClosed && hoverLineRef.current) {
      map.removeOverlay(hoverLineRef.current);
      hoverLineRef.current = null;
    }

    vertexAnnotationsRef.current.forEach((a) => map.removeAnnotation(a));
    vertexAnnotationsRef.current = [];
    if (polygonOverlayRef.current) {
      map.removeOverlay(polygonOverlayRef.current);
      polygonOverlayRef.current = null;
    }

    // 頂点マーカー。★始点だけ大きく縁取りして「ここをクリックすると閉じる」目印にする
    drawPoints.forEach((p, i) => {
      const isFirst = i === 0;
      const showAsCloseTarget = isFirst && !drawClosed && drawPoints.length >= 3;
      const ann = new mk.Annotation(
        new mk.Coordinate(p.lat, p.lng),
        () => {
          const d = document.createElement("div");
          if (showAsCloseTarget) {
            // 閉じられる状態の始点：大きめ＋白リング＋うっすら脈動で目立たせる
            d.style.cssText =
              "width:20px;height:20px;border-radius:50%;background:#B3261E;border:3px solid #fff;box-shadow:0 0 0 3px rgba(179,38,30,0.35),0 1px 4px rgba(0,0,0,0.4);";
            d.title = "ここをクリックすると囲いを閉じます";
          } else if (isFirst) {
            d.style.cssText =
              "width:14px;height:14px;border-radius:50%;background:#B3261E;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4);";
          } else {
            d.style.cssText =
              "width:12px;height:12px;border-radius:50%;background:#662510;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4);";
          }
          return d;
        },
        { anchorOffset: new DOMPoint(0, 0), enabled: false }
      );
      map.addAnnotation(ann);
      vertexAnnotationsRef.current.push(ann);
    });

    if (drawClosed && drawPoints.length >= 3) {
      // ★閉じた後：面（ポリゴン）を表示 ＝ 確定した形
      const coords = drawPoints.map((p) => new mk.Coordinate(p.lat, p.lng));
      const overlay = new mk.PolygonOverlay(coords, {
        style: new mk.Style({
          fillColor: "#662510",
          fillOpacity: 0.25,
          strokeColor: "#662510",
          lineWidth: 2,
        }),
        enabled: false, // 面がタップを吸収するのを防ぐ
      });
      map.addOverlay(overlay);
      polygonOverlayRef.current = overlay;
    } else if (drawPoints.length >= 2) {
      // ★打っている最中：確定した辺だけを実線の折れ線で表示（面は作らない）
      const coords = drawPoints.map((p) => new mk.Coordinate(p.lat, p.lng));
      const overlay = new mk.PolylineOverlay(coords, {
        style: new mk.Style({
          strokeColor: "#662510",
          lineWidth: 2.5, // 実線＝確定した線、の意味
        }),
        enabled: false,
      });
      map.addOverlay(overlay);
      polygonOverlayRef.current = overlay;
    }
  }, [drawPoints, drawClosed]);

  // 住所へジャンプ（メイン地図のSearchBarと同じNominatimを使用）
  const jumpTo = async () => {
    if (!jumpQuery.trim() || !adminMapRef.current) return;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(jumpQuery)}`
      );
      const arr = await res.json();
      if (!arr?.[0]) {
        setMessage("場所が見つかりませんでした。表記を変えて試してください");
        return;
      }
      const mk = (window as any).mapkit;
      adminMapRef.current.setRegionAnimated(
        new mk.CoordinateRegion(
          new mk.Coordinate(Number(arr[0].lat), Number(arr[0].lon)),
          new mk.CoordinateSpan(0.004, 0.004)
        )
      );
    } catch {
      setMessage("検索に失敗しました");
    }
  };

  // 地図で描いた形を禁止エリアとして登録
  const registerDrawnPolygon = async () => {
    if (drawPoints.length < 3) {
      setMessage("頂点を3つ以上タップしてください");
      return;
    }
    if (!areaName.trim()) {
      setMessage("先にエリア名を入力してください");
      return;
    }
    // 始点クリックで閉じていなくても、このボタンなら閉じたものとして登録する
    // （建物が密集していて始点をうまくクリックできない場合の保険）
    if (!drawClosed) setDrawClosed(true);

    // GeoJSONのPolygonは [経度, 緯度] の順で、最初と最後の点を一致させて輪を閉じる
    const ring = drawPoints.map((p) => [p.lng, p.lat]);
    ring.push([drawPoints[0].lng, drawPoints[0].lat]);

    const res = await api("/api/admin/excluded-areas", {
      method: "POST",
      body: JSON.stringify({
        name: areaName.trim(),
        reason: areaReason.trim() || null,
        geojson: { type: "Polygon", coordinates: [ring] },
      }),
    });
    if (res.ok) {
      setMessage("禁止エリアを登録しました");
      setDrawPoints([]);
      setDrawClosed(false);
      setAreaName("");
      setAreaReason("");
      loadAreas();
    } else {
      const j = await res.json().catch(() => null);
      setMessage("登録に失敗しました：" + (j?.error ?? "不明なエラー"));
    }
  };

  // クレーム対応：エリア内の既存投稿を全削除（2段階：1回目で赤くなり、2回目で実行）
  const purgeArea = async (id: number) => {
    if (armedPurgeId !== id) {
      setArmedPurgeId(id);
      return;
    }
    setArmedPurgeId(null);
    const res = await api("/api/admin/excluded-areas", {
      method: "PUT",
      body: JSON.stringify({ purge_area_id: id }),
    });
    if (res.ok) {
      const json = await res.json();
      setMessage(
        `エリア #${id} 内の投稿を${json.deleted}件削除しました（周辺の霧の色は自動で更新されます）`
      );
    } else {
      setMessage("エリア内投稿の削除に失敗しました");
    }
  };

  // 合言葉付きfetchの共通処理
  const api = async (path: string, options: RequestInit = {}) => {
    const res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": adminKey,
        ...(options.headers ?? {}),
      },
    });
    if (res.status === 401) {
      setAuthed(false);
      localStorage.removeItem("adminKey");
      setMessage("合言葉が違います。入力し直してください。");
      throw new Error("unauthorized");
    }
    return res;
  };

  const loadReports = async (
    key = adminKey,
    unchecked = uncheckedOnly,
    hiddenOnly = hiddenOnlyFilter
  ) => {
    const params: string[] = [];
    if (unchecked) params.push("unchecked=1");
    if (hiddenOnly) params.push("hidden=1");
    const res = await fetch(
      `/api/admin/reports${params.length ? "?" + params.join("&") : ""}`,
      { headers: { "x-admin-key": key } }
    );
    if (res.status === 401) {
      setAuthed(false);
      localStorage.removeItem("adminKey");
      setMessage("合言葉が違います。");
      return false;
    }
    const json = await res.json();
    setReports(json.reports ?? []);
    return true;
  };

  const loadAreas = async (key = adminKey) => {
    const res = await fetch("/api/admin/excluded-areas", {
      headers: { "x-admin-key": key },
    });
    if (!res.ok) return;
    const json = await res.json();
    setAreas(json.areas ?? []);
  };

  // 起動時：sessionStorageに合言葉が残っていれば自動ログイン
  useEffect(() => {
    const saved = localStorage.getItem("adminKey");
    if (saved) {
      setAdminKey(saved);
      loadReports(saved).then((ok) => {
        if (ok) {
          setAuthed(true);
          loadAreas(saved);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async () => {
    const key = keyInput.trim();
    if (!key) return;
    setAdminKey(key);
    setMessage("");
    const res = await fetch("/api/admin/reports", {
      headers: { "x-admin-key": key },
    });
    if (res.status === 401) {
      setMessage("合言葉が違います。");
      return;
    }
    const json = await res.json();
    setReports(json.reports ?? []);
    localStorage.setItem("adminKey", key);
    setAuthed(true);
    loadAreas(key);
  };

  const toggleChecked = async (r: AdminReport) => {
    await api("/api/admin/reports", {
      method: "PATCH",
      body: JSON.stringify({ id: r.id, checked: !r.checked }),
    });
    setReports((prev) =>
      prev.map((x) => (x.id === r.id ? { ...x, checked: !r.checked } : x))
    );
  };

  // 🟡 霧だけの非表示／再表示を切り替える。
  //    投稿データは消さず、地図から霧だけを消す（いつでも戻せる）。
  //    削除依頼物件に隣家の霧がかかる場合などに使う。
  const toggleHidden = async (r: AdminReport) => {
    const next = !r.hidden;
    const res = await api("/api/admin/reports", {
      method: "PATCH",
      body: JSON.stringify({ id: r.id, hidden: next }),
    });
    if (res.ok) {
      // 「非表示のみ表示」で絞り込み中に再表示した行は、一覧から外れるので除く
      if (hiddenOnlyFilter && !next) {
        setReports((prev) => prev.filter((x) => x.id !== r.id));
      } else {
        setReports((prev) =>
          prev.map((x) => (x.id === r.id ? { ...x, hidden: next } : x))
        );
      }
      setMessage(
        next
          ? `投稿 #${r.id} の霧を地図から隠しました（データは残っています）`
          : `投稿 #${r.id} の霧を地図に戻しました`
      );
    }
  };

  // 投稿の削除（2段階：1回目で赤くなり、2回目で実行）
  const deleteReport = async (r: AdminReport) => {
    if (armedDeleteId !== r.id) {
      setArmedDeleteId(r.id);
      return;
    }
    setArmedDeleteId(null);
    const res = await api("/api/admin/reports", {
      method: "DELETE",
      body: JSON.stringify({ id: r.id }),
    });
    if (res.ok) {
      setReports((prev) => prev.filter((x) => x.id !== r.id));
      setMessage(`投稿 #${r.id} を削除しました（周辺の霧の色は自動で更新されます）`);
    } else {
      setMessage(`投稿 #${r.id} の削除に失敗しました`);
    }
  };

  // イタズラ即応：この投稿の地点を中心に、円形の禁止エリアを登録
  const excludeAround = async (r: AdminReport) => {
    const res = await api("/api/admin/excluded-areas", {
      method: "POST",
      body: JSON.stringify({
        name: `即応エリア（投稿#${r.id}周辺）`,
        reason: "イタズラ対応",
        lat: r.lat,
        lng: r.lng,
        radius_m: radiusM,
      }),
    });
    if (res.ok) {
      setMessage(
        `投稿 #${r.id} の地点・半径${radiusM}mを禁止エリアにしました。投稿自体は残っているので、不要なら別途削除してください。`
      );
      loadAreas();
    } else {
      setMessage("禁止エリアの登録に失敗しました");
    }
  };

  const addGeojsonArea = async () => {
    if (!areaName.trim() || !areaGeojson.trim()) {
      setMessage("エリア名とGeoJSONの両方を入力してください");
      return;
    }
    const res = await api("/api/admin/excluded-areas", {
      method: "POST",
      body: JSON.stringify({
        name: areaName.trim(),
        reason: areaReason.trim() || null,
        geojson: areaGeojson,
      }),
    });
    if (res.ok) {
      setMessage("禁止エリアを登録しました");
      setAreaName("");
      setAreaReason("");
      setAreaGeojson("");
      loadAreas();
    } else {
      const json = await res.json().catch(() => null);
      setMessage(
        "登録に失敗しました：" +
          (json?.error === "invalid_geojson" || json?.error === "no_geometry"
            ? "GeoJSONの形式が正しくありません。geojson.io右側のJSON全文をそのまま貼ってください。"
            : json?.error ?? "不明なエラー")
      );
    }
  };

  const deleteArea = async (id: number) => {
    const res = await api("/api/admin/excluded-areas", {
      method: "DELETE",
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      setAreas((prev) => prev.filter((a) => a.id !== id));
      setMessage(`禁止エリア #${id} を削除しました`);
    }
  };

  const btn = (primary = false): React.CSSProperties => ({
    background: primary ? BRAND : "transparent",
    color: primary ? "#fff" : BRAND,
    border: `1.5px solid ${BRAND}`,
    padding: "6px 12px",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  });

  // ============================================================
  // 合言葉入力ゲート
  // ============================================================
  if (!authed) {
    return (
      <main style={{ maxWidth: 420, margin: "80px auto", padding: 24, color: TEXT }}>
        <h1 style={{ fontSize: 20, marginBottom: 16 }}>🪳 ゴキブリマップ 管理画面</h1>
        <p style={{ fontSize: 13, color: SUB, marginBottom: 16 }}>
          合言葉（ADMIN_SECRET）を入力してください。
        </p>
        <input
          type="password"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          style={{
            width: "100%",
            padding: 12,
            border: "1px solid #ccc",
            borderRadius: 8,
            fontSize: 14,
            marginBottom: 12,
            boxSizing: "border-box",
          }}
        />
        <button onClick={handleLogin} style={{ ...btn(true), width: "100%", padding: 12 }}>
          入る
        </button>
        {message && (
          <p style={{ color: "#B3261E", fontSize: 13, marginTop: 12 }}>{message}</p>
        )}
      </main>
    );
  }

  // ============================================================
  // 管理画面本体
  // ============================================================
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24, color: TEXT }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>🪳 ゴキブリマップ 管理画面</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <a
            href="/?admin"
            target="_blank"
            rel="noopener"
            style={{ ...btn(), textDecoration: "none", display: "inline-block" }}
          >
            地図を管理者モードで開く
          </a>
          <button
            onClick={() => {
              localStorage.removeItem("adminKey");
              setAuthed(false);
              setAdminKey("");
              setKeyInput("");
            }}
            style={btn()}
          >
            ログアウト
          </button>
        </div>
      </div>
      <p style={{ fontSize: 12, color: SUB, marginBottom: 16 }}>
        このページのURL・合言葉は誰にも教えないでください。共用PCで使ったときは必ずログアウトしてください。
      </p>

      {/* タブ切替 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => setTab("reports")}
          style={btn(tab === "reports")}
        >
          投稿チェック
        </button>
        <button onClick={() => setTab("areas")} style={btn(tab === "areas")}>
          投稿禁止エリア
        </button>
      </div>

      {message && (
        <p
          style={{
            background: "#FEF3EC",
            border: `1px solid ${BRAND}`,
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {message}
        </p>
      )}

      {/* ============================================================
          タブ1：投稿チェック
         ============================================================ */}
      {tab === "reports" && (
        <section>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginBottom: 12,
              flexWrap: "wrap",
            }}
          >
            <label style={{ fontSize: 13, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={uncheckedOnly}
                onChange={async (e) => {
                  setUncheckedOnly(e.target.checked);
                  await loadReports(adminKey, e.target.checked, hiddenOnlyFilter);
                }}
              />{" "}
              未チェックのみ表示
            </label>
            {/* 🟡 霧を非表示にした投稿だけを一覧する（地図では🟡ピンで表示される） */}
            <label style={{ fontSize: 13, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={hiddenOnlyFilter}
                onChange={async (e) => {
                  setHiddenOnlyFilter(e.target.checked);
                  await loadReports(adminKey, uncheckedOnly, e.target.checked);
                }}
              />{" "}
              🟡霧を非表示にした投稿のみ
            </label>
            <label style={{ fontSize: 13 }}>
              禁止エリア化の半径：
              <input
                type="number"
                value={radiusM}
                min={5}
                max={5000}
                onChange={(e) => setRadiusM(Number(e.target.value))}
                style={{ width: 70, padding: 4, marginLeft: 4 }}
              />
              m
            </label>
            <button onClick={() => loadReports()} style={btn()}>
              再読込
            </button>
            <span style={{ fontSize: 12, color: SUB }}>{reports.length}件表示中</span>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${BRAND}`, textAlign: "left" }}>
                  <th style={{ padding: 8 }}>✓</th>
                  <th style={{ padding: 8 }}>#</th>
                  <th style={{ padding: 8 }}>投稿日時</th>
                  <th style={{ padding: 8 }}>目撃日</th>
                  <th style={{ padding: 8 }}>住所</th>
                  <th style={{ padding: 8 }}>詳細</th>
                  <th style={{ padding: 8 }}>近隣件数</th>
                  <th style={{ padding: 8 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr
                    key={r.id}
                    style={{
                      borderBottom: "1px solid #eee",
                      // 🟡霧を非表示にした行は薄い黄色（地図の🟡ピンと対応）。
                      // それ以外はチェック済みならグレー、未チェックは白。
                      background: r.hidden
                        ? "#FFF9E6"
                        : r.checked
                        ? "#F7F5F4"
                        : "transparent",
                      color: r.checked && !r.hidden ? SUB : TEXT,
                    }}
                  >
                    <td style={{ padding: 8 }}>
                      <input
                        type="checkbox"
                        checked={r.checked}
                        onChange={() => toggleChecked(r)}
                        title="チェック済みにする"
                      />
                    </td>
                    <td style={{ padding: 8 }}>{r.id}</td>
                    <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                      {new Date(r.created_at).toLocaleString("ja-JP")}
                    </td>
                    <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                      {r.occurred_on ?? "-"}
                    </td>
                    <td style={{ padding: 8, maxWidth: 220, wordBreak: "break-all" }}>
                      {r.report_details?.address ?? "-"}
                    </td>
                    <td style={{ padding: 8, maxWidth: 280, wordBreak: "break-all" }}>
                      {r.report_details?.detail ?? "-"}
                    </td>
                    <td style={{ padding: 8, textAlign: "center" }}>{r.nearby_count}</td>
                    <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                      <button
                        onClick={() => toggleHidden(r)}
                        style={{
                          ...btn(),
                          marginRight: 6,
                          background: r.hidden ? "#FFF4CC" : "transparent",
                        }}
                        title={
                          r.hidden
                            ? "地図に霧を再表示します"
                            : "投稿は残したまま、地図の霧だけ消します"
                        }
                      >
                        {r.hidden ? "🟡霧を戻す" : "霧を隠す"}
                      </button>
                      <button
                        onClick={() => deleteReport(r)}
                        style={{
                          ...btn(),
                          color: "#fff",
                          background: armedDeleteId === r.id ? "#B3261E" : "#D9938B",
                          border: "none",
                          marginRight: 6,
                        }}
                      >
                        {armedDeleteId === r.id ? "本当に削除" : "削除"}
                      </button>
                      <button onClick={() => excludeAround(r)} style={btn()}>
                        禁止エリア化
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, color: SUB, marginTop: 8 }}>
            ・削除すると住所・詳細も一緒に消え、周辺の霧の色（近隣件数）は自動で更新されます。投稿記録（IP等）は開示請求対応のため残ります。
            <br />
            ・「禁止エリア化」はその投稿の地点を中心に、上で指定した半径の円形エリアを登録します。投稿自体は消えないので、必要なら削除も押してください。
          </p>
        </section>
      )}

      {/* ============================================================
          タブ2：投稿禁止エリア
         ============================================================ */}
      {tab === "areas" && (
        <section>
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>新規登録</h2>
          <p style={{ fontSize: 12, color: SUB, marginBottom: 8 }}>
            まずエリア名（と理由）を入力してから、下のどちらかの方法で範囲を指定してください。
          </p>
          <input
            value={areaName}
            onChange={(e) => setAreaName(e.target.value)}
            placeholder="エリア名（例：〇〇マンション／皇居）"
            style={{
              width: "100%",
              padding: 10,
              border: "1px solid #ccc",
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 8,
              boxSizing: "border-box",
            }}
          />
          <input
            value={areaReason}
            onChange={(e) => setAreaReason(e.target.value)}
            placeholder="理由（任意。例：オーナー様からの削除依頼）"
            style={{
              width: "100%",
              padding: 10,
              border: "1px solid #ccc",
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 8,
              boxSizing: "border-box",
            }}
          />

          {/* ============================================================
              方法A（推奨）：地図上で建物の角をタップして囲う
             ============================================================ */}
          <h3 style={{ fontSize: 14, marginBottom: 6 }}>方法A（推奨）：地図上で建物を囲う</h3>
          <p style={{ fontSize: 12, color: SUB, marginBottom: 8 }}>
            建物の角を順にタップすると実線がつながっていきます。最後に<b>始点（赤い大きな印）</b>をクリックすると囲いが閉じて確定し、「この形で登録する」で登録できます。
          </p>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <input
              value={jumpQuery}
              onChange={(e) => setJumpQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && jumpTo()}
              placeholder="住所・建物名で地図を移動（例：浦安市舞浜1-1）"
              style={{
                flex: 1,
                minWidth: 240,
                padding: 8,
                border: "1px solid #ccc",
                borderRadius: 8,
                fontSize: 13,
              }}
            />
            <button onClick={jumpTo} style={btn()}>
              移動
            </button>
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="checkbox"
                checked={satellite}
                onChange={(e) => setSatellite(e.target.checked)}
              />
              航空写真
            </label>
          </div>
          <div
            ref={mapDivRef}
            style={{
              width: "100%",
              height: 420,
              borderRadius: 10,
              overflow: "hidden",
              border: "1px solid #ccc",
              marginBottom: 8,
              // ★右下をつまんでドラッグすると窓枠を広げられる（ブラウザ標準のresize機能）
              resize: "both",
              minHeight: 300,
              minWidth: 320,
            }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => {
                // 閉じた後に「1つ戻す」を押したら、まず閉じ状態を解いて編集に戻る
                if (drawClosed) {
                  setDrawClosed(false);
                } else {
                  setDrawPoints((prev) => prev.slice(0, -1));
                }
              }}
              style={btn()}
              disabled={drawPoints.length === 0}
            >
              1つ戻す
            </button>
            <button
              onClick={() => {
                setDrawPoints([]);
                setDrawClosed(false);
              }}
              style={btn()}
              disabled={drawPoints.length === 0}
            >
              やり直し
            </button>
            <button onClick={registerDrawnPolygon} style={btn(true)}>
              この形で登録する
            </button>
            <span style={{ fontSize: 12, color: SUB }}>
              頂点：{drawPoints.length}個
              {drawClosed
                ? "（閉じました。登録できます）"
                : drawPoints.length >= 3
                  ? "（始点をクリックすると閉じます）"
                  : ""}
            </span>
          </div>

          {/* ============================================================
              方法B（予備）：geojson.ioで描いたGeoJSONの貼り付け
             ============================================================ */}
          <h3 style={{ fontSize: 14, margin: "24px 0 6px" }}>方法B（予備）：GeoJSONの貼り付け</h3>
          <p style={{ fontSize: 12, color: SUB, marginBottom: 8 }}>
            geojson.io などで作ったGeoJSON（FeatureCollection／Feature／Polygon）を貼り付けて登録できます。広域・複雑な形状用の予備手段です。
          </p>
          <textarea
            value={areaGeojson}
            onChange={(e) => setAreaGeojson(e.target.value)}
            placeholder='GeoJSONを貼り付け（{"type":"FeatureCollection",...}）'
            rows={5}
            style={{
              width: "100%",
              padding: 10,
              border: "1px solid #ccc",
              borderRadius: 8,
              fontSize: 12,
              fontFamily: "monospace",
              marginBottom: 8,
              boxSizing: "border-box",
            }}
          />
          <button onClick={addGeojsonArea} style={btn(true)}>
            貼り付けた内容で登録する
          </button>

          <h2 style={{ fontSize: 16, margin: "24px 0 8px" }}>登録済みエリア</h2>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${BRAND}`, textAlign: "left" }}>
                <th style={{ padding: 8 }}>#</th>
                <th style={{ padding: 8 }}>名前</th>
                <th style={{ padding: 8 }}>理由</th>
                <th style={{ padding: 8 }}>登録日</th>
                <th style={{ padding: 8 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {areas.map((a) => (
                <tr key={a.id} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: 8 }}>{a.id}</td>
                  <td style={{ padding: 8 }}>{a.name}</td>
                  <td style={{ padding: 8 }}>{a.reason ?? "-"}</td>
                  <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                    {new Date(a.created_at).toLocaleDateString("ja-JP")}
                  </td>
                  <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                    <button
                      onClick={() => purgeArea(a.id)}
                      style={{
                        ...btn(),
                        color: "#fff",
                        background: armedPurgeId === a.id ? "#B3261E" : "#D9938B",
                        border: "none",
                        marginRight: 6,
                      }}
                    >
                      {armedPurgeId === a.id ? "本当に全削除" : "エリア内の投稿を全削除"}
                    </button>
                    <button onClick={() => deleteArea(a.id)} style={btn()}>
                      エリアを削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: SUB, marginTop: 8 }}>
            ・「エリア内の投稿を全削除」＝そのエリアの中にある既存投稿（霧）を一掃します。管理会社・オーナーからの削除依頼には、「①geojson.ioで建物の形を囲って登録 → ②このボタンで中の投稿を全削除」のセットで対応してください。以後、その建物への新規投稿も自動で拒否されます。
            <br />
            ・「エリアを削除」＝禁止指定を解除します。その場所への投稿が再びできるようになります（消した投稿は戻りません）。
          </p>
        </section>
      )}
    </main>
  );
}
