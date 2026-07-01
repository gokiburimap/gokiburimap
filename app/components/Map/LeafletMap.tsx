"use client";

import { useEffect, useState, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
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

interface LeafletMapProps {
  onMapClick: (lat: number, lng: number) => void;
  reportPos: { lat: number; lng: number } | null;
  isSelecting: boolean;
  onStartInput: (lat: number, lng: number) => void;
  onCancel: () => void;
  refreshTrigger: number;
}

export default function LeafletMap({
  onMapClick,
  reportPos,
  isSelecting,
  onStartInput,
  onCancel,
  refreshTrigger,
}: LeafletMapProps) {
  const [reports, setReports] = useState<Report[]>([]);
  const mapRef = useRef<L.Map | null>(null);
  const reportMarkerRef = useRef<L.Marker | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const isSelectingRef = useRef(isSelecting);
  const onMapClickRef = useRef(onMapClick);

  useEffect(() => {
    isSelectingRef.current = isSelecting;
    onMapClickRef.current = onMapClick;
    if (mapRef.current) {
      mapRef.current.getContainer().style.cursor = isSelecting ? "crosshair" : "";
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
    const map = L.map("map").setView([35.6812, 139.7671], 12);
    mapRef.current = map;

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
      }
    ).addTo(map);

    map.on("click", async (e) => {
      if (!isSelectingRef.current) return;

      const { lat, lng } = e.latlng;

      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
          { headers: { "Accept-Language": "ja" } }
        );
        const data = await res.json();
        console.log("Nominatim結果:", data);

        const cls = data?.class || "";
        const dataType = data?.type || "";
        const addresstype = data?.addresstype || "";

        const forbiddenClass = ["waterway", "natural", "highway", "railway"];
        const forbiddenType = ["water", "river", "stream", "sea", "coastline", "road"];
        const forbiddenAddress = ["road", "waterway"];

        if (
          forbiddenClass.includes(cls) ||
          forbiddenType.includes(dataType) ||
          forbiddenAddress.includes(addresstype)
        ) {
          L.popup()
            .setLatLng(e.latlng)
            .setContent("⚠️ この場所には投稿できません")
            .openOn(map);
          return;
        }

        onMapClickRef.current(lat, lng);
      } catch {
        onMapClickRef.current(lat, lng);
      }
    });

    return () => {
      map.remove();
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;

    markersRef.current.forEach((m) => mapRef.current!.removeLayer(m));
    markersRef.current = [];

    reports.forEach((report) => {
      const icon = L.divIcon({
        html: `<div style="font-size:24px;">🪳</div>`,
        className: "",
        iconSize: [24, 24],
      });
      const marker = L.marker([report.lat, report.lng], { icon })
        .addTo(mapRef.current!)
        .bindPopup(`<b>${report.building_name}</b>`);
      markersRef.current.push(marker);
    });
  }, [reports]);

  useEffect(() => {
    if (!mapRef.current) return;

    if (reportMarkerRef.current) {
      mapRef.current.removeLayer(reportMarkerRef.current);
      reportMarkerRef.current = null;
    }

    if (reportPos) {
      const icon = L.divIcon({
        html: `<div style="font-size:36px;cursor:grab;">🪳</div>`,
        className: "",
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      const marker = L.marker([reportPos.lat, reportPos.lng], {
        icon,
        draggable: true,
      }).addTo(mapRef.current);

      const popupContent = document.createElement("div");
      popupContent.style.textAlign = "center";
      popupContent.style.minWidth = "200px";
      popupContent.innerHTML = `
        <p style="margin:0 0 8px;font-size:13px;">ゴキブリをドラッグして<br/>位置を調整してください</p>
        <p style="margin:0 0 12px;font-size:11px;color:#888;">長押しでドラッグ開始</p>
      `;

      const inputBtn = document.createElement("button");
      inputBtn.textContent = "目撃情報を入力";
      inputBtn.style.cssText = "background:#ef4444;color:white;border:none;padding:8px 12px;border-radius:6px;cursor:pointer;margin-right:6px;font-size:13px;";
      inputBtn.onclick = () => {
        const pos = marker.getLatLng();
        onStartInput(pos.lat, pos.lng);
      };

      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "キャンセル";
      cancelBtn.style.cssText = "background:#f3f4f6;border:1px solid #ddd;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:13px;";
      cancelBtn.onclick = onCancel;

      const btnRow = document.createElement("div");
      btnRow.appendChild(inputBtn);
      btnRow.appendChild(cancelBtn);
      popupContent.appendChild(btnRow);

      marker.bindPopup(L.popup({ closeButton: false }).setContent(popupContent));
      marker.openPopup();

      marker.on("dragend", () => {
        marker.openPopup();
      });

      reportMarkerRef.current = marker;
    }
  }, [reportPos]);

  const handleSearch = (lat: number, lng: number) => {
    if (mapRef.current) {
      mapRef.current.setView([lat, lng], 16);
    }
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <SearchBar onSearch={handleSearch} />
      <div id="map" style={{ width: "100%", height: "100%" }} />
    </div>
  );
}