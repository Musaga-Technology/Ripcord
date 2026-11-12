'use client';
// Paying a reserve from any wallet, in any token, on any chain: Aurora's Intents widget swaps what the person holds,
// through NEAR Intents, into exactly the USDC this guard's deposit address waits for on Arbitrum. It sends only to that
// address; the guard's wallet then credits its private balance as for any other deposit. Loaded only when chosen.
import '@aurora-is-near/intents-swap-widget/styles.css';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useUnsafeSnapshot, WidgetConfigProvider, WidgetSwap } from '@aurora-is-near/intents-swap-widget';
import { evm } from '@aurora-is-near/intents-swap-widget-evm';
import { ARBITRUM_USDC, AURORA_KEY } from '../../lib/aurora';
import { connectWallet, walletProvider } from '../../lib/wallet';

interface Eip1193 {
  request(request: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
}

/**
 * Keeps "Buy" at exactly the reserve. The widget quotes for what arrives (exact output) only after the Buy box is
 * typed in, which no setting reaches, so the box is filled the way a person fills it, and again if it ever drifts.
 */
function HoldAmount({ amount, root }: { amount: string; root: RefObject<HTMLDivElement | null> }) {
  const { ctx } = useUnsafeSnapshot();
  useEffect(() => {
    if (!ctx.targetToken || Number(ctx.targetTokenAmount) === Number(amount)) return;
    const buy = root.current?.querySelectorAll('input')[1];
    if (!buy) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(buy, amount);
    buy.dispatchEvent(new Event('input', { bubbles: true }));
  }, [ctx.targetToken, ctx.targetTokenAmount, amount, root]);
  return null;
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
  const [who, setWho] = useState(wallet);
  const root = useRef<HTMLDivElement>(null);

  return (
    // Dark in both themes, like the guard's card: a payment, held apart from the page around it.
    <div ref={root} className="bg-[#111114] p-2">
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
          // Routed through NEAR's private shard: the paying wallet and the route can't be traced to this guard.
          // Checked with dry quotes to an outside address: it still delivers the exact amount, for 0.05% more on
          // stablecoins.
          confidentialMode: 'confidential',
        }}
        theme={{
          colorScheme: 'dark',
          accentColor: '#e8a33d',
          backgroundColor: '#111114',
          borderRadius: 'lg',
          stylePreset: 'clean',
          showContainer: false,
        }}
      >
        <HoldAmount amount={amount} root={root} />
        <WidgetSwap onMsg={(m) => m.type === 'on_transfer_success' && onSent()} />
      </WidgetConfigProvider>
    </div>
  );
}
