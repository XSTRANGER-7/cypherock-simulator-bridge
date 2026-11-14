# SDK integration

Goal: `@cypherock/sdk-hw-simulator` lives in your SDK fork beside `hw-hid` and `hw-webusb`, with real types.

## 1. Study the HID transport first

```bash
cd ../sdk
grep -Rn "interface IDeviceConnection" packages
cat packages/hw-hid/src/deviceConnection.ts   # or the file that implements it
cat packages/hw-hid/package.json
```

Note:
- every method in `IDeviceConnection` and its exact signature
- how `send` is called: once per packet, or with a whole message
- how `receive` behaves when nothing is waiting (returns undefined? throws? blocks?)
- how sequence numbers wrap
- which error class and codes it throws

## 2. Copy the package

```bash
cp -r ../cypherock-simulator-bridge/packages/hw-simulator packages/hw-simulator
```

## 3. Switch to the real types

Replace `packages/hw-simulator/src/types.ts` with:

```ts
export type { IDeviceConnection } from '@cypherock/sdk-interfaces';
export { DeviceState } from '@cypherock/sdk-interfaces';
export interface SimulatorConnectionOptions {
  host?: string;
  port?: number;
  connectTimeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  frameSize?: number;
  logger?: (message: string) => void;
}
```

Add to `packages/hw-simulator/package.json`:

```json
"dependencies": {
  "@cypherock/sdk-interfaces": "workspace:*"
}
```

Run `pnpm i && pnpm build`. Fix each type error in `deviceConnection.ts`; every error is a place where the real contract differs from the local copy.

## 4. Match conventions

Copy from `packages/hw-hid`:
- `tsconfig.json`, lint config, `jest`/test config
- `package.json` scripts, `main`/`types` fields, version

Map `SimulatorConnectionError` codes to the SDK's `DeviceConnectionError` so app packages handle them like USB errors.

## 5. Tests

Move `tests/` to the SDK's test runner. The mock device can come along as a test helper (`packages/hw-simulator/tests/helpers/mockDevice.ts`).

## 6. Prove it

```bash
pnpm build
cd ../cypherock-simulator-bridge
SDK_DIR=../sdk npx tsx examples/get-device-info.ts
```

## 7. Changeset

If the SDK uses changesets: `pnpm changeset` → minor, "Add hw-simulator transport for the X1 firmware simulator".
