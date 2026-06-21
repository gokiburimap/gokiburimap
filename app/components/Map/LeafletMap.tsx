"use client";

import { useEffect } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface Marker {
  id: number;
  lat: number;
  lng: number;
  title: string;
  type: "found" | "not_found";
}

interface LeafletMapProps {
  markers?: Marker[];
}

export default function LeafletMap({ markers = [] }: LeafletMapProps) {
  useEffect(() => {
    const map = L.map("map").setView([35.6812, 139.7671], 12);

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
      }
    ).addTo(map);

    markers.forEach((marker) => {
      const color = marker.type === "found" ? "red" : "green";
      const icon = L.divIcon({
        html: `<div style="background:${color};width:24px;height:24px;border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:14px;">🪳</div>`,
        className: "",
        iconSize: [24, 24],
      });

      L.marker([marker.lat, marker.lng], { icon })
        .addTo(map)
        .bindPopup(`<b>${marker.title}</b>`);
    });

    return () => {
      map.remove();
    };
  }, [markers]);

  return <div id="map" style={{ width: "100%", height: "100vh" }} />;
}