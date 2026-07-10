import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const lat = req.nextUrl.searchParams.get('lat');
  const lon = req.nextUrl.searchParams.get('lon');

  if (!lat || !lon) {
    return NextResponse.json({ error: 'lat/lon required' }, { status: 400 });
  }

  const url = `https://map.yahooapis.jp/geoapi/V1/reverseGeoCoder?output=json&lat=${lat}&lon=${lon}&appid=${process.env.YAHOO_CLIENT_ID}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    const feature = data.Feature?.[0];
    if (!feature) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    // Yahooのレスポンスは Property.AddressElement 配列で
    // prefecture / city / oaza(丁目) / detail(番地) のレベルに分かれている
    const elements = feature.Property?.AddressElement ?? [];
    const get = (level: string) =>
      elements.find((e: any) => e.Level === level)?.Name ?? '';

const prefecture = get('prefecture');
const city = get('city');
const oaza = get('oaza');       // 日本橋本町
const aza = get('aza');         // ４丁目
const detail1 = get('detail1'); // １

const fullAddress = feature.Property?.Address ?? '';

return NextResponse.json({
  prefecture,
  city,
  address: `${oaza}${aza}${detail1}`.trim() || fullAddress,
  fullAddress,
  lat: parseFloat(lat),
  lng: parseFloat(lon),
});
  } catch (e) {
    return NextResponse.json({ error: 'yahoo api error' }, { status: 500 });
  }
}