/**
 * The playground's operations: one real SDK call each, checked against
 * ethers where possible. Shared by the Node server (playground/server.ts,
 * simulator over TCP) and the browser build (web/, firmware compiled to
 * WebAssembly in the same tab). Nothing here touches Node or the DOM: the
 * host passes in how to reach the device and how to load SDK packages.
 */
import { ethers } from 'ethers';
import { describeFrame, encodePacket, PACKET_TYPE } from '../examples/lib/packets';
import { decodeVarintFields, IDLE_STATE_NAMES, waitIdle } from '../examples/lib/status';

export const H = 0x80000000;
export const DEFAULT_TEST_MNEMONIC = 'test test test test test test test test test test test junk';
export type Params = Record<string, any>;

export interface OpsEnv {
  /** Published test mnemonic the simulator's SIMTEST wallet was loaded with. */
  mnemonic: string;
  /** An IDeviceConnection to the simulator (opened on demand). */
  connection(): Promise<any>;
  /** An SDK package by folder name, e.g. 'core', 'app-manager', 'app-evm'. */
  app(folder: string): Promise<any>;
  /** A library an SDK app expects to be injected, e.g. ('app-xrp', 'xrpl'). */
  lib(folder: string, name: string): Promise<any>;
}

interface CoinDef {
  folder: string;
  cls: string;
  path: number[];
  setup?: (mod: any, env: OpsEnv) => Promise<void>;
}

export const EVM_CHAINS = [1, 137, 56, 250, 43114, 10, 42161, 8453, 999];

export const BTC: Record<string, [number, number]> = { btc: [44, 0], 'btc-segwit': [84, 0], ltc: [44, 2], doge: [44, 3], dash: [44, 5] };

export const COINS: Record<string, CoinDef> = {
  solana: { folder: 'app-solana', cls: 'SolanaApp', path: [44 + H, 501 + H, H] },
  near: { folder: 'app-near', cls: 'NearApp', path: [44 + H, 397 + H, H, H, 1 + H] },
  tron: {
    folder: 'app-tron',
    cls: 'TronApp',
    path: [44 + H, 195 + H, H, 0, 0],
    setup: async (m, env) => {
      const tw = await env.lib('app-tron', 'tronweb');
      const TronWeb = tw.TronWeb ?? tw.default?.TronWeb ?? tw.default ?? tw;
      // Only used to encode the address offline; the host is never contacted.
      m.setTronWeb(new TronWeb({ fullHost: 'http://127.0.0.1:9' }));
    },
  },
  xrp: { folder: 'app-xrp', cls: 'XrpApp', path: [44 + H, 144 + H, H, 0, 0], setup: async (m, env) => m.setXrpLib(await env.lib('app-xrp', 'xrpl')) },
  starknet: { folder: 'app-starknet', cls: 'StarknetApp', path: [0xa55 + H, 0x4741e9c9 + H, 0x447a6028 + H, H, H, 0] },
  icp: { folder: 'app-icp', cls: 'IcpApp', path: [44 + H, 223 + H, H, 0, 0] },
  stellar: { folder: 'app-stellar', cls: 'StellarApp', path: [44 + H, 148 + H, H], setup: async (m, env) => m.setStellarLib(await env.lib('app-stellar', 'stellar-sdk')) },
  constellation: {
    folder: 'app-constellation',
    cls: 'ConstellationApp',
    path: [44 + H, 1137 + H, H, 0, 0],
    setup: async (m, env) => m.setDag4Lib(await env.lib('app-constellation', '@stardust-collective/dag4')),
  },
  sia: { folder: 'app-sia', cls: 'SiaApp', path: [0] },
  canton: {
    folder: 'app-canton',
    cls: 'CantonApp',
    path: [44 + H, 6767 + H, H, H, H],
    setup: async (m, env) => m.setCantonLib(await env.lib('app-canton', '@canton-network/core-ledger-proto')),
  },
};

export function hex(bytes: Uint8Array | string): string {
  if (typeof bytes === 'string') return bytes;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const sig0x = (s: string) => (s.startsWith('0x') ? s : `0x${s}`);

export function createOps(env: OpsEnv) {
  let walletId: Uint8Array | undefined;
  const evmExpected = (p: string) => ethers.HDNodeWallet.fromPhrase(env.mnemonic, undefined, p).address;

  async function manager() {
    return (await env.app('app-manager')).ManagerApp.create(await env.connection());
  }

  async function simtest(): Promise<Uint8Array> {
    if (walletId) return walletId;
    const { walletList } = await (await manager()).getWallets();
    const w = walletList.find((x: any) => x.name === 'SIMTEST');
    if (!w) throw new Error('SIMTEST wallet not found (the simulator must be started with CYPHEROCK_SIM_TEST_MNEMONIC)');
    walletId = w.id;
    return w.id;
  }

  async function evmApp() {
    const mod = await env.app('app-evm');
    mod.setEthersLib(ethers);
    return mod.EvmApp.create(await env.connection());
  }

  /** After a failed call: abort whatever the firmware is doing and wait for idle. */
  async function recover() {
    try {
      (await env.app('core')).SDK.sendAbort(await env.connection());
    } catch {
      /* nothing running */
    }
    const c = await env.connection();
    for (let i = 0; i < 200 && (await c.receive()); i += 1) {
      /* drain */
    }
    await waitIdle(c, { timeoutMs: 20000 });
  }

  const OPS: Record<string, (p: Params) => Promise<unknown>> = {
    async 'raw-status'() {
      // One STATUS_REQ packet straight onto the wire (no SDK), and the exact reply bytes.
      const c = await env.connection();
      for (let i = 0; i < 200 && (await c.receive()); i += 1) {
        /* drop stale frames */
      }
      const request = encodePacket({ type: PACKET_TYPE.STATUS_REQ, sequence: 0xffff });
      await c.send(request);
      let reply: Uint8Array | undefined;
      for (let i = 0; i < 1500 && !reply; i += 1) {
        const f = await c.receive();
        if (f && f[0] === 0x55 && f[10] === PACKET_TYPE.STATUS) reply = f;
        else if (!f) await new Promise((r) => setTimeout(r, 2));
      }
      if (!reply) throw new Error('no STATUS reply');
      const replyPacket = reply.subarray(0, 16 + reply[15]);
      const payload = reply.subarray(16, 16 + reply[15]);
      const status = decodeVarintFields(payload.subarray(4, 4 + ((payload[0] << 8) | payload[1])));
      return {
        requestHex: hex(request),
        replyHex: hex(replyPacket),
        request: describeFrame(request),
        reply: describeFrame(reply),
        status,
        idle: IDLE_STATE_NAMES[status?.[2] ?? 0],
      };
    },
    async 'device-info'() {
      const m = await manager();
      return { sdkVersion: m.getSDKVersion(), ...(await m.getDeviceInfo()) };
    },
    async wallets() {
      return (await manager()).getWallets();
    },
    async 'eth-address'(p) {
      const chainId = Number(p.chainId ?? 1);
      const index = Number(p.index ?? 0);
      const derivation = `m/44'/60'/0'/0/${index}`;
      const app = await evmApp();
      const r = await app.getPublicKeys({ walletId: await simtest(), derivationPaths: [{ path: [44 + H, 60 + H, H, 0, index] }], chainId });
      const expected = evmExpected(derivation);
      return { chainId, derivation, address: r.addresses[0], publicKey: r.publicKeys[0], verified: r.addresses[0].toLowerCase() === expected.toLowerCase(), expectedFromMnemonic: expected };
    },
    async 'sign-tx'(p) {
      const chainId = Number(p.chainId ?? 1);
      const unsigned = ethers.Transaction.from({
        type: 2,
        chainId,
        nonce: Number(p.nonce ?? 0),
        gasLimit: 21000,
        to: p.to || '0x000000000000000000000000000000000000dEaD',
        value: ethers.parseEther(String(p.valueEth ?? '0.001')),
        maxFeePerGas: ethers.parseUnits('30', 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei'),
      }).unsignedSerialized;
      const app = await evmApp();
      const r = await app.signTxn({ walletId: await simtest(), derivationPath: [44 + H, 60 + H, H, 0, 0], txn: unsigned, serializeTxn: true });
      const signed = sig0x(r.serializedTxn);
      const from = ethers.Transaction.from(signed).from ?? '';
      const expected = evmExpected("m/44'/60'/0'/0/0");
      return { chainId, unsigned, signature: r.signature, signed, recoveredSigner: from, verified: from.toLowerCase() === expected.toLowerCase(), note: 'Never broadcast: test mnemonic' };
    },
    async 'sign-message'(p) {
      const text = String(p.text ?? 'Hello from the Cypherock X1 simulator');
      const app = await evmApp();
      const r = await app.signPersonalMsg({ walletId: await simtest(), derivationPath: [44 + H, 60 + H, H, 0, 0], message: ethers.hexlify(ethers.toUtf8Bytes(text)).slice(2) });
      const signer = ethers.verifyMessage(text, sig0x(r.serializedSignature));
      return { text, signature: sig0x(r.serializedSignature), recoveredSigner: signer, verified: signer.toLowerCase() === evmExpected("m/44'/60'/0'/0/0").toLowerCase() };
    },
    async 'sign-typed-data'() {
      const domain = { name: 'Ether Mail', version: '1', chainId: 1, verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' };
      const types = {
        Person: [{ name: 'name', type: 'string' }, { name: 'wallet', type: 'address' }],
        Mail: [{ name: 'from', type: 'Person' }, { name: 'to', type: 'Person' }, { name: 'contents', type: 'string' }],
      };
      const message = {
        from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
        to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
        contents: 'Hello, Bob!',
      };
      const typed = {
        domain,
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' }, { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' },
          ],
          ...types,
        },
        primaryType: 'Mail',
        message,
      };
      const app = await evmApp();
      const r = await app.signTypedMsg({ walletId: await simtest(), derivationPath: [44 + H, 60 + H, H, 0, 0], message: typed });
      const signer = ethers.verifyTypedData(domain, types, message, sig0x(r.serializedSignature));
      return { typedData: typed, signature: sig0x(r.serializedSignature), recoveredSigner: signer, verified: signer.toLowerCase() === evmExpected("m/44'/60'/0'/0/0").toLowerCase() };
    },
    async 'btc-xpub'(p) {
      const coin = String(p.coin ?? 'btc');
      const [purpose, coinType] = BTC[coin] ?? BTC.btc;
      const mod = await env.app('app-btc');
      mod.setBitcoinJSLib(await env.lib('app-btc', 'bitcoinjs-lib'));
      const app = await mod.BtcApp.create(await env.connection());
      const r = await app.getXpubs({ walletId: await simtest(), derivationPaths: [{ path: [purpose + H, coinType + H, H] }] });
      const out: Record<string, unknown> = { coin, derivation: `m/${purpose}'/${coinType}'/0'`, xpub: r.xpubs[0] };
      if (coin === 'btc') {
        const expected = ethers.HDNodeWallet.fromPhrase(env.mnemonic, undefined, "m/44'/0'/0'").neuter().extendedKey;
        out.verified = expected === r.xpubs[0];
      }
      return out;
    },
    async 'coin-key'(p) {
      const name = String(p.coin ?? 'solana');
      const c = COINS[name];
      if (!c) throw new Error(`unknown coin ${name}`);
      const mod = await env.app(c.folder);
      await c.setup?.(mod, env);
      const app = await mod[c.cls].create(await env.connection());
      const r = await app.getPublicKeys({ walletId: await simtest(), derivationPaths: [{ path: c.path }] });
      return { coin: name, path: c.path.map((n) => (n >= H ? `${n - H}'` : String(n))).join('/'), ...r };
    },
  };

  return {
    OPS,
    recover,
    /** Call after the simulator restarts: wallet ids are re-read next time. */
    forgetWallet() {
      walletId = undefined;
    },
  };
}
