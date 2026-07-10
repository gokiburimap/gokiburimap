import jwt from 'jsonwebtoken';
import { NextResponse } from 'next/server';

export async function GET() {
  const token = jwt.sign({}, process.env.MAPKIT_PRIVATE_KEY!.replace(/\\n/g, '\n'), {
    algorithm: 'ES256',
    expiresIn: '1h',
    issuer: process.env.MAPKIT_TEAM_ID,
    keyid: process.env.MAPKIT_KEY_ID,
  });
  return new NextResponse(token, { headers: { 'Content-Type': 'text/plain' } });
}