"use client";

import { useEffect, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "../../lib/supabase";

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

export default function LeafletMap() {
  const [reports, setReports] = useState<Report[]>([]);

  useEffect(() => {
    const fetchReports = async () => {
      const { data } = await supabase.from("reports").select("*");
      if (data) setReports(data);
    };
    fetchReports();
  }, []);

  useEffect(() => {
    if (reports.length === 0) return;

    const map = L.map("map").setView([35.6812, 139.7671], 12);

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
      }
    ).addTo(map);

    reports.forEach((report) => {
      const icon = L.divIcon({
        html: `<div style="font-size:24px;">🪳</div>`,
        className: "",
        iconSize: [24, 24],
      });

      L.marker([report.lat, report.lng], { icon })
        .addTo(map)
        .bindPopup(`
          <b>${report.building_name}</b><br/>
          発生場所：${report.position}<br/>
          時期：${report.period_year}年${report.period_month}月<br/>
          種類：${report.species}<br/>
          状況：${report.situation}
        `);
    });

    return () => {
      map.remove();
    };
  }, [reports]);

  return <div id="map" style={{ width: "100%", height: "100vh" }} />;
}