"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import Supercluster from "supercluster";
import { supabase } from "../../lib/supabase";
import SearchBar from "../SearchBar";

interface Report {
  id: number;
  lat: number;
  lng: number;
  building_name: string;
  position: string;
  period_year: number;
  period_month: number;
  species: string;
  situation: string;
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
}

export interface AppleMapHandle {
  isZoomedInEnough: () => boolean;
}

declare global {
  interface Window {
    mapkit: any;
  }
}

const ZOOM_THRESHOLD = 0.002;

// クラスタの分岐をここで止める（これ以上ズームしても分岐しない＝個別の建物が特定できる状態にはならない）
const FREEZE_ZOOM = 15;

// 円が表す「実世界の半径」の目安（メートル）。ズームインするとこの半径が画面上で大きく表示される。
const REAL_RADIUS_METERS = 110;
const METERS_PER_DEGREE_LAT = 111320;

// 地図の表示範囲(緯度スパン)とコンテナの高さから、実世界基準の円の直径(px)を計算する
// ズームインする(=latitudeDeltaが小さくなる)ほど、同じ実世界サイズが画面上では大きく見える
function getZoomScaledCircleSize(
  latitudeDelta: number,
  containerHeightPx: number,
  count: number
) {
  const degreesForRadius = REAL_RADIUS_METERS / METERS_PER_DEGREE_LAT;
  const pixelsPerDegree = containerHeightPx / latitudeDelta;
  let diameterPx = degreesForRadius * pixelsPerDegree * 2;

  // 件数が多いクラスタは、補助的にわずかに大きく見せる
  diameterPx += Math.log2(count + 1) * 4;

  // 極端に小さい/巨大になりすぎないようclamp
  return Math.round(Math.min(Math.max(diameterPx, 28), 160));
}

const createClusterIconUrl = (count: number, size: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    // 件数に応じて塗りの濃さを決める（多いほど濃く、ただし上限あり）
    // 対数スケールにしているのは、件数の桁が増えても急激に濃くなりすぎないようにするため
    const opacity = Math.min(0.15 + Math.log10(count + 1) * 0.18, 0.65);

    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(102, 37, 16, ${opacity})`; // #662510 をopacity付きで
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#292524"; // 白文字→ブランドと調和するダーク文字に変更（薄い塗りの上でも読みやすいように）
    const digits = String(count).length;
    const fontScale = digits <= 2 ? 0.4 : digits === 3 ? 0.34 : digits === 4 ? 0.28 : 0.22;
    ctx.font = `bold ${Math.round(size * fontScale)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(count), size / 2, size / 2 + 1);
  }
  return canvas.toDataURL();
};

// クラスタリングして、現在のズームに応じたマーカー（個別ピン or 集約ピン）を描画
function renderMarkers(
  map: any,
  reports: Report[],
  markersRef: { current: any[] },
  clusterIndexRef: { current: Supercluster | null },
  containerEl: HTMLDivElement | null
) {
  markersRef.current.forEach((m) => map.removeAnnotation(m));

  if (!clusterIndexRef.current) {
    // maxZoomをFREEZE_ZOOMに固定 → これ以上はクラスタが分岐しない（＝個別ピンが露出しない）
    clusterIndexRef.current = new Supercluster({ radius: 60, maxZoom: FREEZE_ZOOM });
  }
  clusterIndexRef.current.load(
    reports.map((r) => ({
      type: "Feature",
      properties: { report: r },
      geometry: { type: "Point", coordinates: [r.lng, r.lat] },
    })) as any
  );

  const span = map.region.span;
  const center = map.region.center;
  const bbox: [number, number, number, number] = [
    center.longitude - span.longitudeDelta / 2,
    center.latitude - span.latitudeDelta / 2,
    center.longitude + span.longitudeDelta / 2,
    center.latitude + span.latitudeDelta / 2,
  ];
  const rawZoom = Math.max(0, Math.min(20, Math.round(Math.log2(360 / span.longitudeDelta))));
  const zoom = Math.min(rawZoom, FREEZE_ZOOM); // ここでも二重にclampして安全側に倒す
  const clusters = clusterIndexRef.current.getClusters(bbox, zoom);

  const containerHeightPx = containerEl?.clientHeight ?? 600;

  const newMarkers = clusters.map((c: any) => {
    const [lng, lat] = c.geometry.coordinates;
    const coordinate = new window.mapkit.Coordinate(lat, lng);

    // クラスタでも単独点でも、必ず同じ「円+件数」のデザインで統一する
    // （単独1件だけ生の建物名ピンが出てしまうと、匿名化の目的が崩れるため）
    const isCluster = !!c.properties.cluster;
    const count = isCluster ? c.properties.point_count : 1;
    const size = getZoomScaledCircleSize(span.latitudeDelta, containerHeightPx, count);
    const icon = createClusterIconUrl(count, size);

    const annotation = new window.mapkit.ImageAnnotation(coordinate, {
      url: { 1: icon },
      size: { width: size, height: size },
    });

    if (isCluster) {
      annotation.addEventListener("select", () => {
        const expansionZoom = Math.min(
          clusterIndexRef.current!.getClusterExpansionZoom(c.properties.cluster_id),
          FREEZE_ZOOM
        );
        const newSpanDeg = 360 / Math.pow(2, expansionZoom);
        map.setRegionAnimated(
          new window.mapkit.CoordinateRegion(
            new window.mapkit.Coordinate(lat, lng),
            new window.mapkit.CoordinateSpan(newSpanDeg, newSpanDeg)
          )
        );
      });
    }
    // 単独の点(count=1)はタップしても拡大ズームしない（これ以上分解できる情報を持たないため）

    return annotation;
  });

  map.addAnnotations(newMarkers);
  markersRef.current = newMarkers;
}

const AppleMap = forwardRef<AppleMapHandle, AppleMapProps>(function AppleMap(
  { onMapClick, reportPos, isSelecting, onStartInput, onCancel, refreshTrigger },
  ref
) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const reportMarkerRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const clusterIndexRef = useRef<Supercluster | null>(null);
  const [reports, setReports] = useState<Report[]>([]);

  // 画面右上に常時表示する「今の表示範囲内の目撃件数」
  const [visibleCount, setVisibleCount] = useState(0);

  const isSelectingRef = useRef(isSelecting);
  const onMapClickRef = useRef(onMapClick);
  const reportPosRef = useRef(reportPos);
  const reportsRef = useRef<Report[]>([]);

  const onStartInputRef = useRef(onStartInput);
  const onCancelRef = useRef(onCancel);

  // 現在の地図の表示範囲(bounding box)に入っている投稿件数を数えて state に反映する
  const updateVisibleCount = () => {
    const map = mapRef.current;
    if (!map) return;

    const region = map.region;
    const latMin = region.center.latitude - region.span.latitudeDelta / 2;
    const latMax = region.center.latitude + region.span.latitudeDelta / 2;
    const lngMin = region.center.longitude - region.span.longitudeDelta / 2;
    const lngMax = region.center.longitude + region.span.longitudeDelta / 2;

    const count = reportsRef.current.filter(
      (r) => r.lat >= latMin && r.lat <= latMax && r.lng >= lngMin && r.lng <= lngMax
    ).length;

    setVisibleCount(count);
  };

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
  }, [onStartInput, onCancel]);

  useImperativeHandle(ref, () => ({
    isZoomedInEnough: () => {
      if (!mapRef.current) return false;
      return mapRef.current.region.span.latitudeDelta <= ZOOM_THRESHOLD;
    },
  }));

  const fetchReports = async () => {
    const PAGE_SIZE = 1000;
    let allReports: any[] = [];
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from("reports")
        .select("*")
        .order("id", { ascending: true }) // ← 並び順を固定（これが無いと取りこぼしが起きる）
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        console.error("reports取得エラー:", error);
        break;
      }
      if (!data || data.length === 0) break;

      allReports = allReports.concat(data);

      if (data.length < PAGE_SIZE) break; // 最後のページまで取り終えた
      from += PAGE_SIZE;
    }

    setReports(allReports);
  };

  useEffect(() => {
    fetchReports();
  }, [refreshTrigger]);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    let cancelled = false;
    let initialized = false;
    let zoomCheckInterval: ReturnType<typeof setInterval> | null = null;

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
        showsUserLocationControl: true,
      });

      mapRef.current = map;

      let lastSpan = map.region.span.latitudeDelta;
      zoomCheckInterval = setInterval(() => {
        const currentSpan = map.region.span.latitudeDelta;
        if (Math.abs(currentSpan - lastSpan) / lastSpan > 0.1) {
          lastSpan = currentSpan;
          renderMarkers(map, reportsRef.current, markersRef, clusterIndexRef, mapContainerRef.current);
        }
      }, 400);

      // パン・ズーム操作が終わるたびに、右上の目撃件数を再計算する
      map.addEventListener("region-change-end", updateVisibleCount);
      updateVisibleCount();

      map.addEventListener("single-tap", async (event: any) => {
        if (!isSelectingRef.current && !reportPosRef.current) return;

        const coordinate = map.convertPointOnPageToCoordinate(event.pointOnPage);
        const lat = coordinate.latitude;
        const lng = coordinate.longitude;

        try {
          const res = await fetch(`/api/reverse-geocode?lat=${lat}&lon=${lng}`);
          const geoData = await res.json();

          if (geoData.error) {
            onMapClickRef.current(lat, lng);
            return;
          }
          onMapClickRef.current(lat, lng, geoData);
        } catch {
          onMapClickRef.current(lat, lng);
        }
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
      if (zoomCheckInterval) clearInterval(zoomCheckInterval);
      if (mapRef.current) {
        mapRef.current.removeEventListener("region-change-end", updateVisibleCount);
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    reportsRef.current = reports;
    if (!mapRef.current) return;
    renderMarkers(mapRef.current, reports, markersRef, clusterIndexRef, mapContainerRef.current);
    updateVisibleCount(); // データが更新されたら件数も再計算
  }, [reports]);

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
          div.style.fontSize = "22px";
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
          calloutOffset: new DOMPoint(-10.5, 17), // ← この2つの数字だけ動かして微調整してください
        }
      );

      annotation.callout = {
        calloutElementForAnnotation: () => {
          const container = document.createElement("div");
          container.style.textAlign = "center";
          container.style.minWidth = "200px";
          container.innerHTML = `
            <p style="margin:0 0 12px;font-size:13px;color:#292524;">ドラッグして位置を調整してください</p>
          `;

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

      {/* 常時表示：現在の表示範囲内の目撃件数 */}
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          background: "white",
          borderRadius: 10,
          padding: "8px 14px",
          boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
          fontSize: 13,
          fontWeight: 700,
          color: "#292524",
          zIndex: 10,
        }}
      >
        目撃件数 {visibleCount.toLocaleString()}件
      </div>

      <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
});

export default AppleMap;
