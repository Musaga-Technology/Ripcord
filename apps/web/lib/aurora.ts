// Aurora's Intents widget, which lets a reserve be paid from any wallet and token. Its key comes from Aurora's Widget
// Studio; Aurora says it is not secret and is meant for front-end code. Without one, the widget stays off.
export const AURORA_KEY = process.env.NEXT_PUBLIC_AURORA_KEY ?? '';

/** USDC on Arbitrum, as 1Click and the widget name it: what the guard's deposit address waits for. */
export const ARBITRUM_USDC = 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near';
