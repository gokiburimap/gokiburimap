// scripts/seed-test-data.mjs
//
// テスト用：全国の主要都市を中心に、ダミーの投稿データ（reportsテーブル）を
// 大量にバルクインサートするスクリプト。
// クラスタリング／エリア集計の見た目確認用。どうせ本番前にDBリセットする前提。
//
// 使い方：
//   node scripts/seed-test-data.mjs 5000
//   node scripts/seed-test-data.mjs 5000 --clear   ← 実行前にreportsを全削除してから投入
//
// 事前準備：
//   npm install @supabase/supabase-js dotenv
//   .env.local に SUPABASE_SERVICE_ROLE_KEY を追加（Supabase管理画面 > Settings > API から取得）
//   ⚠ service_role キーはRLSを無視できる強力なキー。絶対にフロントに埋め込まない・Gitに上げない。
//     .env.local は既に .gitignore 済みのはずなので、そこに追記するだけでOK。

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が .env.local に見つかりません');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── 全国の主要都市（中心座標・weight=投稿の集まりやすさ・spread=散らばる範囲の目安[度]）
// weightは人口をざっくり参考にした相対値。spreadが大きいほど都市周辺に広く散らばる。
const CITIES = [
  { name: '札幌', lat: 43.0621, lng: 141.3544, weight: 40, spread: 0.12 },
  { name: '仙台', lat: 38.2682, lng: 140.8694, weight: 25, spread: 0.08 },
  { name: 'さいたま', lat: 35.8617, lng: 139.6455, weight: 25, spread: 0.06 },
  { name: '東京23区', lat: 35.6762, lng: 139.6503, weight: 200, spread: 0.10 },
  { name: '横浜', lat: 35.4437, lng: 139.6380, weight: 70, spread: 0.08 },
  { name: '川崎', lat: 35.5308, lng: 139.7029, weight: 30, spread: 0.05 },
  { name: '千葉', lat: 35.6073, lng: 140.1063, weight: 25, spread: 0.07 },
  { name: '新潟', lat: 37.9161, lng: 139.0364, weight: 15, spread: 0.07 },
  { name: '静岡', lat: 34.9756, lng: 138.3828, weight: 15, spread: 0.06 },
  { name: '浜松', lat: 34.7108, lng: 137.7261, weight: 15, spread: 0.06 },
  { name: '名古屋', lat: 35.1815, lng: 136.9066, weight: 90, spread: 0.09 },
  { name: '京都', lat: 35.0116, lng: 135.7681, weight: 35, spread: 0.06 },
  { name: '大阪', lat: 34.6937, lng: 135.5023, weight: 130, spread: 0.10 },
  { name: '堺', lat: 34.5733, lng: 135.4830, weight: 20, spread: 0.05 },
  { name: '神戸', lat: 34.6901, lng: 135.1955, weight: 45, spread: 0.07 },
  { name: '岡山', lat: 34.6551, lng: 133.9195, weight: 18, spread: 0.06 },
  { name: '広島', lat: 34.3853, lng: 132.4553, weight: 30, spread: 0.07 },
  { name: '高松', lat: 34.3401, lng: 134.0434, weight: 10, spread: 0.05 },
  { name: '松山', lat: 33.8392, lng: 132.7657, weight: 12, spread: 0.05 },
  { name: '福岡', lat: 33.5904, lng: 130.4017, weight: 60, spread: 0.08 },
  { name: '北九州', lat: 33.8834, lng: 130.8752, weight: 20, spread: 0.06 },
  { name: '熊本', lat: 32.7898, lng: 130.7417, weight: 18, spread: 0.06 },
  { name: '鹿児島', lat: 31.5966, lng: 130.5571, weight: 15, spread: 0.06 },
  { name: '那覇', lat: 26.2124, lng: 127.6809, weight: 15, spread: 0.05 },
  { name: '金沢', lat: 36.5613, lng: 136.6562, weight: 12, spread: 0.05 },
  { name: '長野', lat: 36.6513, lng: 138.1810, weight: 10, spread: 0.06 },
  { name: '宇都宮', lat: 36.5658, lng: 139.8836, weight: 12, spread: 0.05 },
  { name: '水戸', lat: 36.3418, lng: 140.4468, weight: 8, spread: 0.05 },
];

const SPECIES = ['黒ゴキブリ', 'チャバネ', '不明'];
const SITUATIONS = ['1匹', '複数', '卵も発見'];
const POSITIONS = ['室内', '共用部', '駐車場・外周'];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// weightに応じて都市を重み付き抽選
function pickCity() {
  const total = CITIES.reduce((sum, c) => sum + c.weight, 0);
  let r = Math.random() * total;
  for (const c of CITIES) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return CITIES[0];
}

// Box-Muller法で正規分布っぽいジッター（都市中心に寄るが、たまに離れた場所にも散る）
function gaussianJitter(spread) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z * spread;
}

function makeFakeReport() {
  const city = pickCity();
  const lat = city.lat + gaussianJitter(city.spread);
  const lng = city.lng + gaussianJitter(city.spread);

  return {
    building_name: `テスト投稿（${city.name}周辺）`,
    address: `${city.name}近郊（テストデータ）`,
    lat,
    lng,
    position: pick(POSITIONS),
    period_year: 2024 + Math.floor(Math.random() * 3), // 2024〜2026
    period_month: 1 + Math.floor(Math.random() * 12),
    species: pick(SPECIES),
    situation: pick(SITUATIONS),
    building_id: null, // buildingsテーブルと紐づけ不要（テスト用なのでnull許容前提。制約がある場合は要調整）
  };
}

// コマンドライン引数から --key=value 形式の値を取り出す
function getArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : null;
}

async function main() {
  const count = Number(process.argv[2] ?? 3000);
  const shouldClear = process.argv.includes('--clear');

  // --lat / --lng が指定された場合は、都市リストを使わず、その1点周辺にだけ密集させる
  const centerLat = getArg('lat');
  const centerLng = getArg('lng');
  const customSpread = getArg('spread');

  if (centerLat && centerLng) {
    const lat = Number(centerLat);
    const lng = Number(centerLng);
    const spread = customSpread ? Number(customSpread) : 0.003; // 未指定ならデフォルト約300m四方

    console.log(`📍 指定地点 (${lat}, ${lng}) 周辺、半径目安${spread}度 に密集投稿します`);

    makeFakeReport.__override = () => {
      const jLat = lat + gaussianJitter(spread);
      const jLng = lng + gaussianJitter(spread);
      return {
        building_name: `テスト投稿（指定地点周辺）`,
        address: `指定地点周辺（テストデータ）`,
        lat: jLat,
        lng: jLng,
        position: pick(POSITIONS),
        period_year: 2024 + Math.floor(Math.random() * 3),
        period_month: 1 + Math.floor(Math.random() * 12),
        species: pick(SPECIES),
        situation: pick(SITUATIONS),
        building_id: null,
      };
    };
  }

  if (shouldClear) {
    console.log('🗑  既存のreportsを削除中...');
    const { error } = await supabase.from('reports').delete().neq('id', 0);
    if (error) {
      console.error('削除エラー:', error.message);
      process.exit(1);
    }
  }

  console.log(`🪳 ${count}件のテストデータを生成・投入します...`);

  const BATCH_SIZE = 500; // Supabaseの1リクエストあたりの上限を考慮
  let inserted = 0;

  for (let i = 0; i < count; i += BATCH_SIZE) {
    const batchCount = Math.min(BATCH_SIZE, count - i);
    const generator = makeFakeReport.__override ?? makeFakeReport;
    const rows = Array.from({ length: batchCount }, generator);

    const { error } = await supabase.from('reports').insert(rows);

    if (error) {
      console.error(`❌ バッチ ${i}-${i + batchCount} でエラー:`, error.message);
      console.error('  → building_id が NOT NULL 制約の場合は、先にダミーのbuildingsレコードを');
      console.error('    作成してそのidを使うよう本スクリプトを調整してください。');
      process.exit(1);
    }

    inserted += batchCount;
    console.log(`  ...${inserted}/${count}件 投入済み`);
  }

  console.log(`✅ 完了：${inserted}件のテストデータを投入しました。`);
}

main();
