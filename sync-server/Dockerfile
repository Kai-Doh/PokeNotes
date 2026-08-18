FROM rust:1-slim-bookworm AS builder
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/pokenotes-sync-server /usr/local/bin/pokenotes-sync-server

ENV SYNC_DB_PATH=/data/sync.db
ENV PORT=8787
VOLUME /data
EXPOSE 8787

ENTRYPOINT ["pokenotes-sync-server"]
CMD ["serve"]
