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

const MIN_SPAN = 0.01;
const MAX_SPAN = 20;
const MIN_ICON_SIZE = 8;
const MAX_ICON_SIZE = 20;

function getIconSizeForSpan(latitudeDelta: number) {
  const clamped = Math.min(Math.max(latitudeDelta, MIN_SPAN), MAX_SPAN);
  const t =
    (Math.log(clamped) - Math.log(MIN_SPAN)) /
    (Math.log(MAX_SPAN) - Math.log(MIN_SPAN));
  const size = MAX_ICON_SIZE - t * (MAX_ICON_SIZE - MIN_ICON_SIZE);
  return Math.round(size);
}

function getClusterIconSize(count: number) {
  const size = 32 + Math.log2(count) * 6;
  return Math.round(Math.min(Math.max(size, 32), 56));
}

const createClusterIconUrl = (count: number, size: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.fillStyle = "#662510";
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "white";
    ctx.font = `bold ${Math.round(size * 0.4)}px sans-serif`;
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
  clusterIndexRef: { current: Supercluster | null }
) {
  markersRef.current.forEach((m) => map.removeAnnotation(m));

  if (!clusterIndexRef.current) {
    clusterIndexRef.current = new Supercluster({ radius: 60, maxZoom: 20 });
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
  const zoom = Math.max(0, Math.min(20, Math.round(Math.log2(360 / span.longitudeDelta))));
  const clusters = clusterIndexRef.current.getClusters(bbox, zoom);

  const newMarkers = clusters.map((c: any) => {
    const [lng, lat] = c.geometry.coordinates;
    const coordinate = new window.mapkit.Coordinate(lat, lng);

    if (c.properties.cluster) {
      const count = c.properties.point_count;
      const size = getClusterIconSize(count);
      const icon = createClusterIconUrl(count, size);
      const annotation = new window.mapkit.ImageAnnotation(coordinate, {
        url: { 1: icon },
        size: { width: size, height: size },
      });
      annotation.addEventListener("select", () => {
        const expansionZoom = Math.min(
          clusterIndexRef.current!.getClusterExpansionZoom(c.properties.cluster_id),
          20
        );
        const newSpanDeg = 360 / Math.pow(2, expansionZoom);
        map.setRegionAnimated(
          new window.mapkit.CoordinateRegion(
            new window.mapkit.Coordinate(lat, lng),
            new window.mapkit.CoordinateSpan(newSpanDeg, newSpanDeg)
          )
        );
      });
      return annotation;
    }

    const report: Report = c.properties.report;
    const size = getIconSizeForSpan(span.latitudeDelta);

    const annotation = new window.mapkit.Annotation(
      coordinate,
      () => {
        const div = document.createElement("div");
        div.style.width = "24px";
        div.style.height = "24px";
        div.style.display = "flex";
        div.style.alignItems = "center";
        div.style.justifyContent = "center";
        div.style.fontSize = "20px";
        div.style.cursor = "grab";
        div.style.touchAction = "none";
        div.textContent = "🪳";
        return div;
      },
      { calloutEnabled: true }
    );

    annotation.callout = {
      calloutElementForAnnotation: () => {
        const el = document.createElement("div");
        el.style.cssText =
          "background:white;border-radius:10px;padding:10px 14px;box-shadow:0 2px 10px rgba(0,0,0,0.15);min-width:160px;";
        el.innerHTML = `
          <div style="font-size:13px;font-weight:700;color:#1f2937;margin-bottom:4px;">${report.building_name}</div>
          <div style="font-size:11px;color:#6b7280;">${report.period_year}年${report.period_month}月・${report.species}</div>
        `;
        return el;
      },
    };

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

  const isSelectingRef = useRef(isSelecting);
  const onMapClickRef = useRef(onMapClick);
  const reportPosRef = useRef(reportPos);
  const reportsRef = useRef<Report[]>([]);

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
          renderMarkers(map, reportsRef.current, markersRef, clusterIndexRef);
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

  useEffect(() => {
    reportsRef.current = reports;
    if (!mapRef.current) return;
    renderMarkers(mapRef.current, reports, markersRef, clusterIndexRef);
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
          calloutOffset: new DOMPoint(-10.5,17), // ← この2つの数字だけ動かして微調整してください
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
      <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
});

export default AppleMap;