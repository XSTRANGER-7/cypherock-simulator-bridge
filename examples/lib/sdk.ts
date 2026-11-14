/**
 * Loads Cypherock SDK app packages.
 *
 * Order:
 *   1. Installed npm packages (@cypherock/sdk-app-*)
 *   2. Your local SDK fork at $SDK_DIR/packages/<name> (run `pnpm build` there)
 *
 * Typed as `any` on purpose: this repo must build without the SDK present.
 * Inside the SDK fork you get full types from the real packages.
 */
import path from 'node:path';

const sdkDir = process.env.SDK_DIR ?? path.resolve(__dirname, '../../../sdk');

function load(npmName: string, folder: string): any {
  try {
    return require(npmName);
  } catch {
    const local = path.join(sdkDir, 'packages', folder);
    try {
      return require(local);
    } catch (error) {
      throw new Error(
        `Could not load ${npmName}. Either "npm i ${npmName}" or build your SDK fork ` +
          `(cd ${sdkDir} && pnpm i && pnpm build). Original error: ${(error as Error).message}`,
      );
    }
  }
}

export const loadManagerApp = () => load('@cypherock/sdk-app-manager', 'app-manager').ManagerApp;
export const loadEvmApp = () => load('@cypherock/sdk-app-evm', 'app-evm');

export function hex(bytes: Uint8Array | string): string {
  return typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('hex');
}
