# One-command web playground for the Cypherock X1 firmware simulator.
#
#   docker build -t x1-sim-playground -f docker/Dockerfile .
#   docker run --rm -p 127.0.0.1:3000:3000 x1-sim-playground
#   open http://127.0.0.1:3000
#
# Builds upstream x1_wallet_firmware + firmware-patch and upstream sdk +
# sdk-patch at pinned commits, then runs the simulator headless (Xvfb) and the
# playground. Publish the port on 127.0.0.1 only: the playground can make the
# simulator sign (with the published test mnemonic).
FROM ubuntu:22.04

ARG FIRMWARE_REF=5b11739d
ARG SDK_REF=4e44158
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake ninja-build git curl unzip ca-certificates xvfb xauth \
      python3 python3-venv python3-pip libsdl2-dev \
    && rm -rf /var/lib/apt/lists/*

# Firmware proto toolchain (HACKING.md): grpcio-tools 1.47.0, protoc 24.4
RUN python3 -m venv /opt/x1venv \
    && /opt/x1venv/bin/pip install --no-cache-dir wheel protobuf grpcio-tools==1.47.0 "setuptools<81" \
    && curl -sSLo /tmp/protoc.zip https://github.com/protocolbuffers/protobuf/releases/download/v24.4/protoc-24.4-linux-x86_64.zip \
    && unzip -o /tmp/protoc.zip -d /usr/local bin/protoc 'include/*' && rm /tmp/protoc.zip
ENV PATH=/opt/x1venv/bin:$PATH

# Node 18 (sdk/.nvmrc) and pnpm 8.6.0 (sdk/package.json)
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/* \
    && npm i -g pnpm@8.6.0

WORKDIR /work
COPY firmware-patch/x1_wallet_firmware.patch /tmp/x1_wallet_firmware.patch
COPY sdk-patch/sdk.patch /tmp/sdk.patch

RUN git clone https://github.com/Cypherock/x1_wallet_firmware.git \
    && cd x1_wallet_firmware && git checkout "$FIRMWARE_REF" \
    && git submodule update --init --recursive \
    && git apply /tmp/x1_wallet_firmware.patch

RUN git clone https://github.com/Cypherock/sdk.git \
    && cd sdk && git checkout "$SDK_REF" \
    && git submodule update --init --recursive \
    && git apply /tmp/sdk.patch \
    && F=""; for a in manager evm btc solana near tron xrp starknet icp stellar constellation sia canton; do F="$F --filter=@cypherock/sdk-app-$a..."; done \
    && pnpm install $(echo "$F" | sed 's/--filter=/--filter /g') --filter "@cypherock/sdk-hw-simulator..." \
    && pnpm exec turbo run build --no-daemon $F --filter=@cypherock/sdk-hw-simulator...

COPY . /work/cypherock-simulator-bridge
WORKDIR /work/cypherock-simulator-bridge
RUN (npm ci || npm install) && ./scripts/build-simulator.sh

ENV PLAYGROUND_HOST=0.0.0.0 \
    PLAYGROUND_PORT=3000 \
    PLAYGROUND_AUTOSTART=1 \
    CYPHEROCK_SIM_TEST_MNEMONIC="test test test test test test test test test test test junk" \
    LOG_LEVEL=error
EXPOSE 3000
CMD ["xvfb-run", "-a", "npx", "tsx", "playground/server.ts"]
