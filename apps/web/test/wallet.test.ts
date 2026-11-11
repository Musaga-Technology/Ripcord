// Funding from Hyperliquid in one wallet signature: the action and typed data match Hyperliquid's own SDK
// (hyperliquid-python-sdk: `usd_transfer`, `USD_SEND_SIGN_TYPES`, `sign_user_signed_action`).
import { describe, expect, it } from 'vitest';
import { usdSendAction, usdSendTypedData } from '../lib/wallet';

const DEPOSIT = '0xa6eb2155B5EDc7D3D6EC14D2b1aE0a20bbdf1414';

describe('the Hyperliquid send that funds a reserve', () => {
  it('is the SDK’s usdSend action, signed on the wallet’s own chain', () => {
    const a = usdSendAction(DEPOSIT, '3.7', '0xa4b1', 1_794_000_000_000);
    expect(a).toEqual({
      type: 'usdSend',
      hyperliquidChain: 'Mainnet',
      signatureChainId: '0xa4b1',
      destination: DEPOSIT,
      amount: '3.7',
      time: 1_794_000_000_000,
    });
    const t = usdSendTypedData(a);
    expect(t.primaryType).toBe('HyperliquidTransaction:UsdSend');
    expect(t.types['HyperliquidTransaction:UsdSend']).toEqual([
      { name: 'hyperliquidChain', type: 'string' },
      { name: 'destination', type: 'string' },
      { name: 'amount', type: 'string' },
      { name: 'time', type: 'uint64' },
    ]);
    expect(t.domain).toEqual({
      name: 'HyperliquidSignTransaction',
      version: '1',
      chainId: 42161,
      verifyingContract: '0x0000000000000000000000000000000000000000',
    });
    expect(t.message).toEqual({
      hyperliquidChain: 'Mainnet',
      destination: DEPOSIT,
      amount: '3.7',
      time: 1_794_000_000_000,
    });
  });
});
