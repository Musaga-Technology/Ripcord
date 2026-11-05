import { NextResponse } from 'next/server';

// 1Click's prices for the reserve assets, cached for a minute. Public data, so no key and nothing about the visitor.
const ONECLICK = 'https://1click.chaindefuser.com/v0/tokens';

export const revalidate = 60;

export async function GET() {
  try {
    const r = await fetch(ONECLICK, { next: { revalidate: 60 } });
    if (!r.ok) return NextResponse.json({ error: 'prices are unavailable' }, { status: 502 });
    const list = (await r.json()) as { assetId: string; price?: number }[];
    return NextResponse.json(Object.fromEntries(list.filter((t) => t.price).map((t) => [t.assetId, t.price])));
  } catch {
    return NextResponse.json({ error: 'prices are unavailable' }, { status: 502 });
  }
}
