import { ImageResponse } from 'next/og';
import { rosette } from '@ripcord/shared';

// The link preview (DESIGN §2: the rosette appears on the share image too): the headline beside a guard card.
export const alt = 'Ripcord · Hidden margin for Hyperliquid';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const COMMITMENT = '7f3a91c2e04b5d18a6f2c3b9d07e41a2b6c8d9e0f1a2b3c4d5e6f708192ac91e';

/** Instrument Sans as TrueType, which the image renderer reads (Google serves it to an old user agent); none if offline. */
async function font(weight: number): Promise<ArrayBuffer | null> {
  try {
    const css = await (
      await fetch(`https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@${weight}`, {
        headers: { 'User-Agent': 'Mozilla/4.0' },
      })
    ).text();
    const url = css.match(/src: url\((.+?)\)/)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function Image() {
  const r = rosette(COMMITMENT);
  const [semibold, regular] = await Promise.all([font(600), font(400)]);
  const fonts = [
    ...(semibold ? [{ name: 'Instrument Sans', data: semibold, weight: 600 as const }] : []),
    ...(regular ? [{ name: 'Instrument Sans', data: regular, weight: 400 as const }] : []),
  ];
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: '#09090B',
        color: '#F4F4F5',
        padding: '0 72px',
        fontFamily: 'Instrument Sans, sans-serif',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28, width: 560 }}>
        <div style={{ fontSize: 112, fontWeight: 600, letterSpacing: '-0.05em', lineHeight: 0.95 }}>Hidden margin.</div>
        <div style={{ fontSize: 30, lineHeight: 1.35, color: '#D4D4D8' }}>
          Everyone can see where your Hyperliquid position dies. Ripcord keeps a reserve nobody can see, and moves it in
          first.
        </div>
      </div>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          width: 480,
          height: 303,
          borderRadius: 28,
          border: '1px solid #26262C',
          background: '#131316',
          overflow: 'hidden',
        }}
      >
        <svg width="480" height="303" viewBox="0 0 600 378" style={{ position: 'absolute', left: 0, top: 0 }}>
          <path d={r.outer} fill="none" stroke="#3A3A44" strokeWidth={1.2} />
          <path d={r.inner} fill="none" stroke="#E8A33D" strokeOpacity={0.55} strokeWidth={1} />
        </svg>
        <div
          style={{
            position: 'absolute',
            left: 28,
            top: 26,
            right: 28,
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 20,
            color: '#D4D4D8',
          }}
        >
          <span>ETH long · 10×</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 9, height: 9, borderRadius: 9, background: '#E8A33D' }} />
            Guarded
          </span>
        </div>
        <div style={{ position: 'absolute', left: 28, top: 110, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 76, fontWeight: 600, letterSpacing: '-0.05em', lineHeight: 1 }}>17.3%</span>
          <span style={{ fontSize: 20, color: '#A1A1AA' }}>from liquidation</span>
        </div>
        <div
          style={{
            position: 'absolute',
            left: 28,
            bottom: 24,
            display: 'flex',
            fontSize: 18,
            letterSpacing: '0.18em',
            color: '#D4D4D8',
            fontFamily: 'monospace',
          }}
        >
          7F3A 91C2 ···· C91E
        </div>
      </div>
    </div>,
    { ...size, fonts },
  );
}
