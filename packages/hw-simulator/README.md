# @cypherock/sdk-hw-simulator

A connection package for the Cypherock SDK that talks to the X1 firmware simulator over TCP instead of USB.

It sits next to `sdk-hw-hid`, `sdk-hw-webusb` and `sdk-hw-serialport`. Every package above it (sdk-core, app-manager, app-evm, app-btc) works unchanged.

## Usage

```ts
import { DeviceConnection } from '@cypherock/sdk-hw-simulator';
import { ManagerApp } from '@cypherock/sdk-app-manager';

const connection = await DeviceConnection.create({ port: 52640 });
const manager = await ManagerApp.create(connection);
console.log(await manager.getDeviceInfo());
await connection.destroy();
```

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `host` | `127.0.0.1` or `CYPHEROCK_SIM_HOST` | Simulator address |
| `port` | `52640` or `CYPHEROCK_SIM_PORT` | Simulator TCP port |
| `connectTimeoutMs` | `3000` | Timeout per connection attempt |
| `retries` | `10` | Attempts before failing (the simulator may still be booting) |
| `retryDelayMs` | `300` | Delay between attempts |
| `frameSize` | `64` | Bytes per frame; must match the firmware bridge |
| `logger` | none | Function that receives raw tx/rx hex logs |

## Errors

All failures throw `SimulatorConnectionError` with a `code`:

| Code | When |
| --- | --- |
| `SIM_CONNECTION_REFUSED` | Nothing listening on host:port |
| `SIM_CONNECTION_TIMEOUT` | Connection attempt timed out |
| `SIM_CONNECTION_CLOSED` | Simulator closed the socket |
| `SIM_NOT_CONNECTED` | Connection was destroyed |
| `SIM_WRITE_FAILED` | Socket write failed |

## Moving this package into the SDK fork

1. Copy this folder to `sdk/packages/hw-simulator`.
2. Replace `src/types.ts` with re-exports from `@cypherock/sdk-interfaces` and fix any type errors.
3. Add `"@cypherock/sdk-interfaces": "workspace:*"` to `package.json` dependencies.
4. Match the SDK's tsconfig, lint and test setup (copy from `packages/hw-hid`).
5. Map `SimulatorConnectionError` to the SDK's `DeviceConnectionError` codes.

See `docs/upstream-prs.md` in the bridge repo for the full checklist.
