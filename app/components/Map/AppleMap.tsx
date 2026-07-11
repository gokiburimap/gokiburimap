"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
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

const ZOOM_THRESHOLD = 0.005;

// ズームレベル(latitudeDelta)に応じたアイコンサイズを計算
// span が小さい(ズームイン)ほど大きく、大きい(ズームアウト)ほど小さく
const MIN_SPAN = 0.01;
const MAX_SPAN = 20;
const MIN_ICON_SIZE = 14;
const MAX_ICON_SIZE = 32;

function getIconSizeForSpan(latitudeDelta: number) {
  const clamped = Math.min(Math.max(latitudeDelta, MIN_SPAN), MAX_SPAN);
  const t =
    (Math.log(clamped) - Math.log(MIN_SPAN)) /
    (Math.log(MAX_SPAN) - Math.log(MIN_SPAN));
  const size = MAX_ICON_SIZE - t * (MAX_ICON_SIZE - MIN_ICON_SIZE);
  return Math.round(size);
}

// 絵文字を透過画像（Data URL）に変換
const createEmojiIconUrl = (emoji: string, size: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.font = `${size * 0.8}px sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(emoji, size / 2, size / 2);
  }
  return canvas.toDataURL();
};

// 投稿一覧マーカーを、現在のズームに合わせたサイズで作り直す
function renderMarkers(map: any, reports: Report[], markersRef: { current: any[] }) {
  markersRef.current.forEach((m) => map.removeAnnotation(m));

  const size = getIconSizeForSpan(map.region.span.latitudeDelta);
  const icon = createEmojiIconUrl("🪳", size); // 表示したいサイズそのもので都度生成する（使い回さない）

  const newMarkers = reports.map((report) => {
    const coordinate = new window.mapkit.Coordinate(report.lat, report.lng);
    return new window.mapkit.ImageAnnotation(coordinate, {
      url: { 1: icon },
      size: { width: size, height: size },
      title: report.building_name,
      calloutEnabled: true,
    });
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
  const [reports, setReports] = useState<Report[]>([]);

  const isSelectingRef = useRef(isSelecting);
  const onMapClickRef = useRef(onMapClick);
  const reportPosRef = useRef(reportPos);
  const reportsRef = useRef<Report[]>([]);

  // コールバック関数を常に最新の状態に保つためのRef
  const onStartInputRef = useRef(onStartInput);
  const onCancelRef = useRef(onCancel);

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
    const { data } = await supabase.from("reports").select("*");
    if (data) setReports(data);
  };

  useEffect(() => {
    fetchReports();
  }, [refreshTrigger]);

  // 地図の初期化
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
        showsCompass: "hidden",
        isRotationEnabled: false,
        showsUserLocationControl: true,
      });

      mapRef.current = map;

      // ズームの変化を定期的にチェックして、変わっていたらマーカーを作り直す
      let lastSpan = map.region.span.latitudeDelta;
      zoomCheckInterval = setInterval(() => {
        const currentSpan = map.region.span.latitudeDelta;
        // 10%以上変化したら「ズームが変わった」とみなす
        if (Math.abs(currentSpan - lastSpan) / lastSpan > 0.1) {
          lastSpan = currentSpan;
          renderMarkers(map, reportsRef.current, markersRef);
        }
      }, 400);

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
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
  }, []);

  // 既存の投稿マーカーの更新
  useEffect(() => {
    reportsRef.current = reports;
    if (!mapRef.current) return;
    renderMarkers(mapRef.current, reports, markersRef);
  }, [reports]);

  // 新規投稿用ドラッグマーカーの生成管理
  useEffect(() => {
    // マップのインスタンスを変数に確保して、タイミングによるエラーを防ぐ
    const currentMap = mapRef.current;
    if (!currentMap) return;

    if (reportMarkerRef.current) {
      currentMap.removeAnnotation(reportMarkerRef.current);
      reportMarkerRef.current = null;
    }

    if (reportPos) {
      currentMap.isZoomEnabled = false; // ピン配置中はズーム操作を禁止
      const coordinate = new window.mapkit.Coordinate(reportPos.lat, reportPos.lng);

      const annotation = new window.mapkit.Annotation(
        coordinate,
        () => {
          const div = document.createElement("div");
          div.style.fontSize = "20px";
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
              currentMap.isScrollEnabled = false; // ドラッグ中は地図のスクロールを止める
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
            currentMap.isScrollEnabled = true; // 地図のスクロールを元に戻す

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
        { draggable: false, calloutEnabled: true }
      );

      // 吹き出し（コールアウト）の中身
      annotation.callout = {
        calloutElementForAnnotation: () => {
          const container = document.createElement("div");
          container.style.textAlign = "center";
          container.style.minWidth = "200px";
          container.innerHTML = `
            <p style="margin:0 0 4px;font-size:13px;">ドラッグして位置を調整してください</p>
            <p style="margin:0 0 8px;font-size:11px;color:#9ca3af;">※地図をタップしても移動できます</p>
          `;

          const inputBtn = document.createElement("button");
          inputBtn.textContent = "目撃情報を入力";
          inputBtn.style.cssText =
            "background:#ef4444;color:white;border:none;padding:8px 12px;border-radius:6px;cursor:pointer;margin-right:6px;font-size:13px;";
          inputBtn.onclick = () => {
            // Refから最新の関数を呼び出すことで、ドラッグ後の最新の座標を親に伝える
            onStartInputRef.current(annotation.coordinate.latitude, annotation.coordinate.longitude);
          };

          const cancelBtn = document.createElement("button");
          cancelBtn.textContent = "キャンセル";
          cancelBtn.style.cssText =
            "background:#f3f4f6;border:1px solid #ddd;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:13px;";
          cancelBtn.onclick = () => onCancelRef.current();

          const btnRow = document.createElement("div");
          btnRow.appendChild(inputBtn);
          btnRow.appendChild(cancelBtn);
          container.appendChild(btnRow);

          return container;
        },
      };

      currentMap.addAnnotation(annotation);
      currentMap.selectedAnnotation = annotation;
      reportMarkerRef.current = annotation;
      } else {
        currentMap.isZoomEnabled = true; // ピンがなくなったらズームを再度許可
    }
  }, [reportPos]); // 依存配列から親の関数を除外し、勝手にリセットされるのを防ぐ

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
      <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
});

export default AppleMap;