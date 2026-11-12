'use client';
// Paying a reserve from any wallet, in any token, on any chain: Aurora's Intents widget swaps what the person holds,
// through NEAR Intents, into exactly the USDC this guard's deposit address waits for on Arbitrum. It sends only to that
// address; the guard's wallet then credits its private balance as for any other deposit. Loaded only when chosen.
import '@aurora-is-near/intents-swap-widget/styles.css';
import { useEffect, useState } from 'react';
import { fireEvent, WidgetConfigProvider, WidgetDepositMode } from '@aurora-is-near/intents-swap-widget';
import { evm } from '@aurora-is-near/intents-swap-widget-evm';
import { ARBITRUM_USDC, AURORA_KEY } from '../../lib/aurora';
import { connectWallet, walletProvider } from '../../lib/wallet';

interface Eip1193 {
  request(request: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
}

function isDark(): boolean {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Follows the page's theme: the toggle's choice, else the system's. */
function useDark(): boolean {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const on = () => setDark(isDark());
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', on);
    const mo = new MutationObserver(on);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener('change', on);
      mo.disconnect();
    };
  }, []);
  return dark;
}

export default function PayAnyWallet({
  address,
  amount,
  wallet,
  onSent,
}: {
  /** The guard's deposit address on Arbitrum. */
  address: string;
  /** Exactly what the reserve takes, in USDC. */
  amount: string;
  /** The connected wallet, if any. */
  wallet: string | null;
  onSent(): void;
}) {
  const dark = useDark();
  const [who, setWho] = useState(wallet);

  // The widget quotes for what arrives (exact output), so the person pays whatever their token costs and the guard's
  // address receives exactly the reserve.
  useEffect(() => {
    const t = setTimeout(() => fireEvent('tokenSetAmount', { variant: 'target', amount }), 300);
    return () => clearTimeout(t);
  }, [amount, address]);

  return (
    <WidgetConfigProvider
      config={{
        apiKey: AURORA_KEY,
        connectedWallets: { default: who },
        providers: {
          evm: async () => {
            const p = await walletProvider();
            if (!p) throw new Error('no wallet');
            // The same EIP-1193 provider; the widget types its params more loosely.
            return p as unknown as Eip1193;
          },
        },
        plugins: { evm },
        onWalletSignin: () => void connectWallet().then(setWho),
        sendAddress: address,
        hideSendAddress: true,
        defaultTargetToken: { symbol: 'USDC', blockchain: 'arb' },
        allowedTargetTokensList: [ARBITRUM_USDC],
        lockSwapDirection: true,
        slippageTolerance: 100,
        confidentialMode: 'public',
      }}
      theme={{
        colorScheme: dark ? 'dark' : 'light',
        accentColor: dark ? '#e8a33d' : '#9a5b00',
        backgroundColor: dark ? '#111114' : '#ffffff',
        borderRadius: 'lg',
        stylePreset: 'clean',
        showContainer: false,
      }}
    >
      <WidgetDepositMode onMsg={(m) => m.type === 'on_transfer_success' && onSent()} />
    </WidgetConfigProvider>
  );
}
