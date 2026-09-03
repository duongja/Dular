# syntax=docker/dockerfile:1.7

ARG FIBER_REF=v0.9.0-rc7

FROM rust:1.93.0-bookworm AS fiber-builder

ARG FIBER_REF

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        clang \
        git \
        libclang-dev \
        libssl-dev \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/fiber

RUN git clone --depth 1 --branch "$FIBER_REF" https://github.com/nervosnetwork/fiber.git .

ENV CARGO_TARGET_DIR=/usr/src/fiber/target

RUN --mount=type=cache,id=cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=cargo-git,target=/usr/local/cargo/git \
    cargo build --release --locked -p fiber-bin -p fnn-cli

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        libssl3 \
        libstdc++6 \
        tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=fiber-builder /usr/src/fiber/target/release/fnn /usr/local/bin/fnn
COPY --from=fiber-builder /usr/src/fiber/target/release/fnn-cli /usr/local/bin/fnn-cli
COPY --from=fiber-builder /usr/src/fiber/config /usr/local/share/fiber/config
COPY railway/fiber/gateway.js /app/gateway.js
COPY railway/fiber/start.sh /usr/local/bin/dular-fiber-start

RUN chmod +x /usr/local/bin/dular-fiber-start

ENV FIBER_HOME=/data \
    FIBER_NETWORK=testnet \
    FIBER_RPC_LISTEN=127.0.0.1:8227 \
    FIBER_P2P_LISTEN=/ip4/127.0.0.1/tcp/8228 \
    FIBER_P2P_HOST=127.0.0.1 \
    FIBER_P2P_PORT=8228 \
    FIBER_RPC_URL=http://127.0.0.1:8227 \
    PORT=3000 \
    RUST_LOG=info

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/local/bin/dular-fiber-start"]
