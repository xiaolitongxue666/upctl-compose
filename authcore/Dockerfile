FROM rust:slim-bookworm AS builder

RUN apt-get update && apt-get install -y libpq-dev pkg-config git && rm -rf /var/lib/apt/lists/*

# Install diesel CLI for migration management
RUN cargo install diesel_cli --no-default-features --features postgres

# Cache-buster: set BUILD_DATE to force re-fetch of latest AuthCore
ARG BUILD_DATE
WORKDIR /app
RUN git clone --depth 1 https://github.com/alchemy-studio/AuthCore.git .

# Patch: bind to 0.0.0.0 so other containers can reach authcore
RUN sed -i 's/127, 0, 0, 1/0, 0, 0, 0/g' htycommons/src/web.rs

# Build the htyuc binary (the auth server)
RUN cargo build --release -p htyuc

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y libpq-dev ca-certificates postgresql-client && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/htyuc /usr/local/bin/
COPY --from=builder /usr/local/cargo/bin/diesel /usr/local/bin/
COPY --from=builder /app/htyuc_models/migrations /app/migrations

# Seed data for dev mode
COPY seed /app/seed

COPY entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["entrypoint.sh"]
