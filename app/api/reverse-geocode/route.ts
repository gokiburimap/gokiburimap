import { NextRequest, NextResponse } from 'next/server';

// ============================================================
// Yahoo逆ジオコーダの AddressElement は入れ子（ネスト）で返ってくる。
//   prefecture(千葉県)
//     └ city(浦安市)
//         └ oaza(舞浜)
//             └ aza(1丁目)
//                 └ detail1(...)
// 以前のコードはトップレベルの配列しか見ていなかったため、
// oaza / aza / detail1 に届かず「舞浜」までで止まっていた。
//
// この関数で、入れ子を再帰的に1本のフラットな配列に均してから
// レベル名で探せるようにする。
// ============================================================
function flattenAddressElements(elements: any[]): any[] {
  const result: any[] = [];
  const walk = (arr: any[]) => {
    if (!Array.isArray(arr)) return;
    for (const el of arr) {
      result.push(el);
      // 子要素も AddressElement という名前でぶら下がっている
      if (Array.isArray(el.AddressElement)) {
        walk(el.AddressElement);
      }
    }
  };
  walk(elements);
  return result;
}

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
      // ============================================================
      // ★2026-07-18 追加：投稿できない場所の判定（その1）
      // Featureが無い ＝ Yahooが住所を返せない ＝ 海・海外など。
      // outOfService フラグを付けて返し、フロント側で弾く。
      // ============================================================
      return NextResponse.json(
        { error: 'not found', outOfService: true },
        { status: 200 }
      );
    }

    // ★入れ子を平らにしてから探す（ここが番地まで取れるかの肝）
    const elements = flattenAddressElements(feature.Property?.AddressElement ?? []);
    const get = (level: string) =>
      elements.find((e: any) => e.Level === level)?.Name ?? '';

    const prefecture = get('prefecture');
    const city = get('city');
    const oaza = get('oaza');       // 舞浜 / 日本橋本町 など
    const aza = get('aza');         // 1丁目 / ４丁目 など
    const detail1 = get('detail1'); // 番地

    const fullAddress = feature.Property?.Address ?? '';

    // ============================================================
    // ★2026-07-18 追加：投稿できない場所の判定（その2）
    // 都道府県が取れない ＝ 日本の住所として成立していない
    // （太平洋・大西洋・海外・排他的経済水域の外側など）。
    //
    // ★まずは「都道府県が無ければ弾く」だけにしている。
    //   市区町村まで必須にすると、離島や境界の正しい投稿まで
    //   巻き込んで弾く恐れがあるため、あえて緩めにしてある。
    //   運用してみて、都道府県だけでは緩いと感じたら、ここの
    //   条件に「|| !city」を足して市区町村まで必須にできる。
    // ============================================================
    if (!prefecture) {
      return NextResponse.json(
        { error: 'out of service area', outOfService: true },
        { status: 200 }
      );
    }
    // ============================================================
    // ★2026-07-19 追加：投稿禁止エリアの判定もタップ時点で行う
    // 従来は投稿ボタンを押した後(APIの検問6)で初めて弾かれていたが、
    // 太平洋・海外と同じく、タップした瞬間に弾く方が体験がよいため。
    // ※APIの検問6は削除しない（フォーム表示中にエリア登録された場合や、
    //   APIを直接叩く投稿への最終防衛線として二重に残す）
    // 判定に失敗した場合は通す（投稿API側の検問6が最後に守るので安全）
    // ============================================================
    try {
      const { getServiceClient } = await import("../../lib/supabase-server");
      const supabase = getServiceClient();
      const { data: isExcluded } = await supabase.rpc("is_in_excluded_area", {
        p_lat: Number(lat),
        p_lng: Number(lon),
      });
      if (isExcluded === true) {
        return NextResponse.json(
          { error: "excluded area", outOfService: true },
          { status: 200 }
        );
      }
    } catch (e) {
      console.error("禁止エリア判定に失敗（タップは通します）:", e);
    }

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
