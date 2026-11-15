# Setup

Two tested setups: **Ubuntu 22.04** (or WSL2 Ubuntu 22.04), and **Windows with MSYS2 UCRT64** (no WSL, no admin rights). Both build the same simulator from the same patch.

## Workspace

```
cypherock/
├── x1_wallet_firmware/            fork, branch feat/simulator-communication (or upstream + firmware-patch)
├── sdk/                           fork, branch feat/simulator-transport (or upstream + sdk-patch)
└── cypherock-simulator-bridge/    this repo
```

### Submodules (both repos)

Submodule URLs in `.gitmodules` are relative (`../cypherock-common`), so on a fork they point at your account and fail. Point them at Cypherock in your local git config. The key is the submodule *name*:

```bash
cd x1_wallet_firmware
git submodule init
git config submodule.stm32-hal.url        https://github.com/Cypherock/x1_wallet_hal_stm32.git
git config submodule.cypherock-common.url https://github.com/Cypherock/cypherock-common.git
git config submodule.nanopb.url           https://github.com/Cypherock/nanopb.git
git config submodule.mini-gmp.url         https://github.com/Cypherock/mini-gmp.git
git config submodule.poseidon.url         https://github.com/Cypherock/poseidon.git
git submodule update --recursive

cd ../sdk
git submodule init
git config submodule.submodules/common.url https://github.com/Cypherock/cypherock-common.git
git submodule update --recursive
```

Both repos pin `cypherock-common` at `a66b02d4`, so firmware and SDK protobufs match. A clone of upstream (not a fork) needs only `git submodule update --init --recursive`.

## Ubuntu 22.04

```bash
sudo apt-get install -y build-essential cmake ninja-build python3-venv libsdl2-dev xvfb unzip
python3 -m venv ~/.venvs/x1 && source ~/.venvs/x1/bin/activate
pip install wheel protobuf grpcio-tools==1.47.0        # HACKING.md; wheels exist up to Python 3.10
curl -LO https://github.com/protocolbuffers/protobuf/releases/download/v24.4/protoc-24.4-linux-x86_64.zip
sudo unzip -o protoc-24.4-linux-x86_64.zip -d /usr/local bin/protoc 'include/*'
# Node 18 (sdk/.nvmrc) and pnpm 8.6.0 (sdk/package.json)
nvm install 18 && npm i -g pnpm@8.6.0
```

## Windows (MSYS2 UCRT64, tested on Windows 11 Home)

1. Install MSYS2 (installer from msys2.org, or the self-extracting archive into a user folder: no admin needed).
2. In the **MSYS2 UCRT64** shell:

```bash
pacman -Syuu
pacman -S --needed make mingw-w64-ucrt-x86_64-{gcc,cmake,ninja,SDL2,python,python-protobuf,python-pip,protobuf,gdb}
# nanopb 0.4.7 imports pkg_resources, which setuptools >= 81 no longer ships
python3 -m venv --system-site-packages ~/x1venv && ~/x1venv/bin/pip install "setuptools<81"
```

3. Build in that shell with the venv active and Windows Node on `PATH` (`MSYS2_PATH_TYPE=inherit`):

```bash
source ~/x1venv/bin/activate
./scripts/build-simulator.sh          # -> x1_wallet_firmware/bin/Cypherock_Simulator.exe
./scripts/start-simulator.sh          # SDL window opens; SDL2.dll comes from /ucrt64/bin
```

What differs on Windows, all handled by the patch:

- `sim_socket.c` uses Winsock (`WSAStartup`, `ioctlsocket`, `closesocket`); `simulator.cmake` links `ws2_32`.
- GCC 16 is much newer than the device's GCC 10.3. On GCC 14+ `simulator.cmake` compiles the simulator with `-std=gnu17` and keeps four checks as warnings (see [limitations.md](limitations.md)).
- The C unit tests (`firmware-patch/test/test_sim_socket.c`) use `fork()`, so `make test` skips them on Windows; the TS <-> C bridge test covers the bridge there.

### SDK build on Windows

The SDK's `prebuild.sh` scripts call `protoc` and pick the Windows plugin path only when `OSTYPE` is `msys` or `win32`. Git Bash reports `cygwin` on some installs, and protoc then fails with "%1 is not a valid Win32 application". Run the SDK build from the MSYS2 shell (`OSTYPE=msys`), or use a `protoc` wrapper that maps `--plugin=.../protoc-gen-ts_proto` to the `.CMD` shim.

```bash
cd ../sdk
pnpm install --filter "@cypherock/sdk-hw-simulator..." --filter "@cypherock/sdk-app-manager..." --filter "@cypherock/sdk-app-evm..."
pnpm exec turbo run build --no-daemon --filter="@cypherock/sdk-hw-simulator..." \
  --filter="@cypherock/sdk-app-manager..." --filter="@cypherock/sdk-app-evm..."
pnpm --filter @cypherock/sdk-hw-simulator test
```

## Check everything

```bash
cd cypherock-simulator-bridge
npm install
CYPHEROCK_SIM=1 CYPHEROCK_SIM_TEST_MNEMONIC="test test test test test test test test test test test junk" \
  ./scripts/run-tests.sh
```

Expected: layer 1 (C, Linux/macOS), layer 2 (17 tests), layer 3 (2 tests), layer 4 (8 tests), "All available test layers passed". Firmware unit tests: `./utilities/run_unit_tests.sh -f main -p simulator` in the firmware repo (130 tests, 0 failures).
