# Setup

## Requirements

| Tool | Version | Why |
| --- | --- | --- |
| Linux, macOS, or WSL2 Ubuntu | | POSIX sockets in the C bridge |
| Node.js | 18+ (match `.nvmrc` in the SDK fork) | SDK and transport |
| pnpm | 8+ | SDK monorepo |
| CMake + Ninja | CMake 3.25+ | Firmware build |
| gcc or clang | any recent | C bridge and simulator |
| Docker | optional | Cypherock's firmware build image |

### Windows

Install WSL2 with Ubuntu, then do everything inside it. Open the folder with VS Code's WSL extension.

```bash
sudo apt-get update
sudo apt-get install -y build-essential cmake ninja-build git curl libudev-dev libusb-1.0-0-dev
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 18 && npm i -g pnpm
```

## Workspace

Keep the three repos as siblings:

```
~/projects/cypherock/
├── x1_wallet_firmware/            your fork
├── sdk/                           your fork
└── cypherock-simulator-bridge/    this repo
```

1. Fork `Cypherock/x1_wallet_firmware` and `Cypherock/sdk` on GitHub.
2. Clone this repo into the workspace.
3. Run `GITHUB_USER=yourname ./scripts/setup.sh`.

`setup.sh` clones both forks with submodules, adds `upstream` remotes, builds the C bridge and installs dev dependencies.

## Branches

```bash
cd ../x1_wallet_firmware && git checkout -b feat/simulator-communication
cd ../sdk && git checkout -b feat/simulator-transport
```

## First-day inspection

Before changing any Cypherock code, find the real names of things:

```bash
cd ../x1_wallet_firmware
find simulator -maxdepth 3 -type f | sort
grep -ni "BUILD_PLATFORM\|Simulator" CMakeLists.txt
grep -Rni "Receive_FS\|Transmit_FS" simulator src | head -20
grep -Rni "packet_parser\|comm_packet" src | head -20
grep -Rni "USE_SIMULATOR\|SIMULATOR" src | head -30

cd ../sdk
grep -Rn "interface IDeviceConnection" packages
ls packages/hw-hid/src
cat .nvmrc
```

Write what you find into `docs/protocol.md` (section "Findings"). It becomes the evidence in your PR descriptions.

## Verify the bridge works on your machine

```bash
./scripts/run-tests.sh
```

Expected: C tests pass, 16 transport tests pass, 2 cross-language tests pass, SDK layer skipped.
