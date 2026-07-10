"use client";

import { useEffect, useRef, useState } from "react";
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

declare global {
  interface Window {
    mapkit: any;
  }
}

export default function AppleMap({
  onMapClick,
  reportPos,
  isSelecting,
  onStartInput,
  onCancel,
  refreshTrigger,
}: AppleMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const reportMarkerRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [reports, setReports] = useState<Report[]>([]);

  const isSelectingRef = useRef(isSelecting);
  const onMapClickRef = useRef(onMapClick);

  useEffect(() => {
    isSelectingRef.current = isSelecting;
    onMapClickRef.current = onMapClick;
    if (mapContainerRef.current) {
      mapContainerRef.current.style.cursor = isSelecting ? "crosshair" : "";
    }
  }, [isSelecting, onMapClick]);

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
        center: new window.mapkit.Coordinate(35.6812, 139.7671),
      });
      mapRef.current = map;

      map.addEventListener("single-tap", async (event: any) => {
        if (!isSelectingRef.current) return;

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
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;

    markersRef.current.forEach((m) => mapRef.current.removeAnnotation(m));

    const newMarkers = reports.map((report) => {
      const coordinate = new window.mapkit.Coordinate(report.lat, report.lng);
      const annotation = new window.mapkit.Annotation(coordinate, () => {
        const div = document.createElement("div");
        div.style.fontSize = "24px";
        div.textContent = "🪳";
        return div;
      });
      annotation.title = report.building_name;
      annotation.calloutEnabled = true;
      return annotation;
    });

    mapRef.current.addAnnotations(newMarkers);
    markersRef.current = newMarkers;
  }, [reports]);

  useEffect(() => {
    if (!mapRef.current) return;

    if (reportMarkerRef.current) {
      mapRef.current.removeAnnotation(reportMarkerRef.current);
      reportMarkerRef.current = null;
    }

    if (reportPos) {
      const coordinate = new window.mapkit.Coordinate(reportPos.lat, reportPos.lng);

      const annotation = new window.mapkit.Annotation(
        coordinate,
        () => {
          const div = document.createElement("div");
          div.style.fontSize = "36px";
          div.style.cursor = "grab";
          div.textContent = "🪳";
          return div;
        },
        { draggable: true, calloutEnabled: true }
      );

      annotation.callout = {
        calloutElementForAnnotation: () => {
          const container = document.createElement("div");
          container.style.textAlign = "center";
          container.style.minWidth = "200px";
          container.innerHTML = `<p style="margin:0 0 8px;font-size:13px;">ゴキブリをドラッグして<br/>位置を調整してください</p>`;

          const inputBtn = document.createElement("button");
          inputBtn.textContent = "目撃情報を入力";
          inputBtn.style.cssText =
            "background:#ef4444;color:white;border:none;padding:8px 12px;border-radius:6px;cursor:pointer;margin-right:6px;font-size:13px;";
          inputBtn.onclick = () => {
            onStartInput(annotation.coordinate.latitude, annotation.coordinate.longitude);
          };

          const cancelBtn = document.createElement("button");
          cancelBtn.textContent = "キャンセル";
          cancelBtn.style.cssText =
            "background:#f3f4f6;border:1px solid #ddd;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:13px;";
          cancelBtn.onclick = onCancel;

          const btnRow = document.createElement("div");
          btnRow.appendChild(inputBtn);
          btnRow.appendChild(cancelBtn);
          container.appendChild(btnRow);
          return container;
        },
      };

      annotation.addEventListener("drag-end", () => {
        mapRef.current.selectedAnnotation = annotation;
      });

      mapRef.current.addAnnotation(annotation);
      mapRef.current.selectedAnnotation = annotation;
      reportMarkerRef.current = annotation;
    }
  }, [reportPos, onStartInput, onCancel]);

  const handleSearch = (lat: number, lng: number) => {
    if (mapRef.current) {
      mapRef.current.setCenterAnimated(new window.mapkit.Coordinate(lat, lng));
    }
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <SearchBar onSearch={handleSearch} />
      <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}