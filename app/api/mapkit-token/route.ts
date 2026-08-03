// app/api/mapkit-token/route.ts
//
// ============================================================
// MapKit JS の認証トークンを返す
//
// 【2026-08-03 変更】origin（利用できるドメイン）の制限を追加した。
//
// 【なぜ必要か】
// これまでのトークンには利用できるドメインの指定が無く、誰でも
// どこのサイトからでも使える状態だった。トークンはブラウザに配られる
// ため、開発者ツールで簡単に取り出せる。
// 他人がこれを自分のサイトに貼れば、Appleへの利用回数がこちらの枠から
// 引かれ、無料枠を超えると課金される可能性があった。
//
// 【仕組み】
// トークンに origin という項目を入れると、そこに書いたドメイン以外では
// 地図が動かなくなる。ただし ★1つのトークンに1つのドメインしか
// 書けない★ ため、次の形にしてある。
//
//   1. リクエストしてきたサイトのドメインを見る
//   2. 下の許可リストに載っていれば、そのドメイン用のトークンを返す
//   3. 載っていなければ、トークンを返さない（403）
//
// ★Apple Developer の画面では設定できない★
//   キーの画面に「Maps」の Edit ボタンがあるが、そこにドメインを
//   登録する欄は無い。MapKit JS のドメイン制限は、この
//   トークン生成側で行うのが正しい方法。
// ============================================================

import jwt from 'jsonwebtoken';
import { NextRequest, NextResponse } from 'next/server';

// ============================================================
// 🔑【許可するドメインはここ】
//
// ★ここに書いていないドメインからは、地図が表示されなくなる★
//
// ・本番、退避先、開発環境の3つを必ず入れておくこと
// ・localhost を消すと、手元で npm run dev したときに地図が出なくなる
// ・末尾のスラッシュは付けない（付けると一致しない）
// ・http と https を間違えない（localhost は http）
//
// 【Vercelのプレビュー環境について】
// Gitにpushするたびに作られる gokiburimap-xxxxx.vercel.app のような
// URLは、毎回変わるためここに書けない。プレビューで地図を見たい場合は、
// 一時的にそのURLをここへ足してデプロイすること。
// ============================================================
const ALLOWED_ORIGINS = [
  'https://gokiburimap.jp',
  'https://gokiburimap.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001', // ポートが埋まっているときに使われる
];

// ★このAPIは、リクエストしてきた相手によって返す内容が変わる。
//   Next.jsに結果を使い回されると、別のドメイン用のトークンが
//   返ってしまうため、毎回作り直すよう明示する。
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // リクエストしてきたサイトのドメインを調べる。
  // ・origin ヘッダー … 別のサイトから呼ばれたときに入る
  // ・referer ヘッダー … 同じサイト内から呼ばれたときの手がかり
  // ・host ヘッダー   … 上2つが無い場合の最後の手がかり
  const originHeader = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const host = req.headers.get('host');

  let requestOrigin: string | null = null;

  if (originHeader) {
    requestOrigin = originHeader;
  } else if (referer) {
    try {
      requestOrigin = new URL(referer).origin;
    } catch {
      /* refererが壊れている場合は次の手段へ */
    }
  }

  if (!requestOrigin && host) {
    // localhost 以外は https とみなす（Vercelは常にhttps）
    const scheme = host.startsWith('localhost') ? 'http' : 'https';
    requestOrigin = `${scheme}://${host}`;
  }

  // 許可リストに載っていなければ、トークンを渡さない
  if (!requestOrigin || !ALLOWED_ORIGINS.includes(requestOrigin)) {
    console.warn('MapKitトークンの要求を拒否しました:', requestOrigin);
    return new NextResponse('forbidden', { status: 403 });
  }

  const token = jwt.sign(
    // ★origin を入れることで、このトークンはこのドメインでしか使えなくなる
    { origin: requestOrigin },
    process.env.MAPKIT_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    {
      algorithm: 'ES256',
      expiresIn: '1h',
      issuer: process.env.MAPKIT_TEAM_ID,
      keyid: process.env.MAPKIT_KEY_ID,
    }
  );

  return new NextResponse(token, {
    headers: {
      'Content-Type': 'text/plain',
      // 念のため、途中の経路にも保存させない
      'Cache-Control': 'no-store',
    },
  });
}