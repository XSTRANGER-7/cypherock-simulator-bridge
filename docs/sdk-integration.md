# SDK integration

The SDK side is [`sdk-patch/sdk.patch`](../sdk-patch/sdk.patch): a new package `packages/hw-simulator` (`@cypherock/sdk-hw-simulator`) and one line in `packages/interfaces/src/connection.ts` (`SIMULATOR: 'simulator'`). It applies cleanly to upstream `sdk` at `4e44158` and is the content of the fork branch `feat/simulator-transport`.

```bash
cd sdk
git apply ../cypherock-simulator-bridge/sdk-patch/sdk.patch
pnpm install
pnpm exec turbo run build --no-daemon --filter="@cypherock/sdk-hw-simulator..."
pnpm --filter @cypherock/sdk-hw-simulator test        # 14 tests
```

## Usage

```ts
import { DeviceConnection } from '@cypherock/sdk-hw-simulator';
import { ManagerApp } from '@cypherock/sdk-app-manager';

const connection = await DeviceConnection.create();   // 127.0.0.1:52640, retries while the simulator boots
const manager = await ManagerApp.create(connection);
const info = await manager.getDeviceInfo();
```

`DeviceConnection.list()` returns one `IDevice` (`path: tcp://127.0.0.1:52640`, `type: 'simulator'`) when a simulator answers, like `hw-hid`'s `list()`.

## Contract, matched to `hw-hid`

| Method | Behaviour | Source it mirrors |
| --- | --- | --- |
| `send(data)` | One 64-byte frame per packet, no report ID | `hw-hid/src/deviceConnection.ts:132-139` |
| `receive()` | Next frame or `undefined` at once | `hw-hid/src/helpers/dataListeners.ts` (`pool.shift()?.data`) |
| `peek()` | `PoolData[]` (`{id, data}`), not consumed, stable ids | used by `core/src/operations/legacy/sendData.ts:88-99` |
| `getNewSequenceNumber()` | `+= 1`, no wrap | `hw-hid/src/deviceConnection.ts:82-85` |
| `beforeOperation()` / `afterOperation()` | No-ops: the socket is always read, frames wait in the pool | `hw-hid` starts/stops its read loop |
| `getDeviceState()` | `DeviceState.MAIN` (simulator is built with `FIRMWARE_TYPE=Main`) | |
| Errors | `DeviceConnectionError` `NOT_CONNECTED` (`CON_0100`) on connect failure, `CONNECTION_CLOSED` (`CON_0101`) on send after close | `interfaces/src/errors/connectionError.ts` |

## Tests

`packages/hw-simulator/tests` (Jest, same setup as `packages/core`):

- framing (5 tests)
- transport against a byte-level mock (8 tests): metadata, padding without report ID, non-blocking `receive`, `peek` shape and stable ids, sequence rule, `CON_0101` after disconnect, `CON_0100` with nothing listening, `list()`
- **real sdk-core handshake:** the mock answers with the firmware's exact bytes (`usb_rx_parser.c:112-153`); the test asserts sdk-core's request equals the firmware's `SDK_REQ_PACKET` and that `SDK.create()` negotiates version `3.0.0` / packet `v3`

ESLint (`lint:check`) and Prettier pass. On Windows, run Prettier as `pnpm exec prettier --check "src/**/*.ts" "tests/**/*.ts"`; the single quotes in the `pretty:check` script (copied from `hw-hid`) do not work in `cmd`.

## Still to do for the upstream PR

- A MkDocs page for the package (`docs/`, `mkdocs.yml`)
- `pnpm changeset`: minor for `@cypherock/sdk-hw-simulator`, patch for `@cypherock/sdk-interfaces`
