/**
 * The Cypherock SDK packages the playground uses, loaded on demand so the
 * first page load stays small. "@sdk/<folder>" and "@sdklib/<folder>/<name>"
 * are resolved by web/build.mjs to the SDK checkout (sdk/packages/<folder>)
 * and to that package's own dependency <name>.
 */
export const APPS: Record<string, () => Promise<any>> = {
  core: () => import('@sdk/core'),
  'app-manager': () => import('@sdk/app-manager'),
  'app-evm': () => import('@sdk/app-evm'),
  'app-btc': () => import('@sdk/app-btc'),
  'app-solana': () => import('@sdk/app-solana'),
  'app-near': () => import('@sdk/app-near'),
  'app-tron': () => import('@sdk/app-tron'),
  'app-xrp': () => import('@sdk/app-xrp'),
  'app-starknet': () => import('@sdk/app-starknet'),
  'app-icp': () => import('@sdk/app-icp'),
  'app-stellar': () => import('@sdk/app-stellar'),
  'app-constellation': () => import('@sdk/app-constellation'),
  'app-sia': () => import('@sdk/app-sia'),
  'app-canton': () => import('@sdk/app-canton'),
};

/** Libraries the SDK apps expect to be injected (setXrpLib, setTronWeb, ...). */
export const LIBS: Record<string, () => Promise<any>> = {
  'app-btc/bitcoinjs-lib': () => import('@sdklib/app-btc/bitcoinjs-lib'),
  'app-tron/tronweb': () => import('@sdklib/app-tron/tronweb'),
  'app-xrp/xrpl': () => import('@sdklib/app-xrp/xrpl'),
  'app-stellar/stellar-sdk': () => import('@sdklib/app-stellar/stellar-sdk'),
  'app-constellation/@stardust-collective/dag4': () => import('@sdklib/app-constellation/@stardust-collective/dag4'),
  'app-canton/@canton-network/core-ledger-proto': () => import('@sdklib/app-canton/@canton-network/core-ledger-proto'),
};
