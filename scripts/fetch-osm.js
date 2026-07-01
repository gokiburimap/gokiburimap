import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// 日本語が含まれているか判定
function isJapaneseName(name) {
  if (!name) return false;
  if (name.length < 3) return false;
  return /[\u3040-\u30ff\u4e00-\u9fff]/.test(name);
}

async function fetchOSMBuildings() {
  const query = `
    [out:json][timeout:180];
    (
      way["building"="apartments"]["name"](35.0,122.0,45.0,154.0);
      way["building"="residential"]["name"](35.0,122.0,45.0,154.0);
      way["building"="commercial"]["name"](35.0,122.0,45.0,154.0);
      way["building"="office"]["name"](35.0,122.0,45.0,154.0);
    );
    out center tags;
  `;

  console.log('OSMからデータ取得中...');
  
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: query
  });

  const data = await response.json();
  console.log(`取得件数：${data.elements.length}件`);
  return data.elements;
}

async function saveBuildings(buildings) {
  const BATCH_SIZE = 1000;
  let count = 0;
  let skipped = 0;

  const records = buildings
    .filter(b => {
      if (!b.center?.lat || !b.center?.lon) return false;
      if (!isJapaneseName(b.tags?.name)) return false;
      return true;
    })
    .map(b => ({
      building_name: b.tags.name,
      address: b.tags['addr:full'] || b.tags['addr:street'] || null,
      prefecture: b.tags['addr:province'] || b.tags['addr:city'] || null,
      lat: b.center.lat,
      lng: b.center.lon,
      source: 'osm',
      verified: false
    }));

  skipped = buildings.length - records.length;
  console.log(`登録対象：${records.length}件（${skipped}件除外）`);

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    
    const { error } = await supabase
      .from('buildings')
      .insert(batch);

    if (error) {
      console.error('登録エラー：', error.message);
    } else {
      count += batch.length;
      console.log(`${count}件登録完了...`);
    }
  }

  console.log(`合計${count}件登録完了`);
}

fetchOSMBuildings()
  .then(saveBuildings)
  .catch(console.error);