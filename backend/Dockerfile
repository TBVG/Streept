FROM rust:1.98.1-bookworm AS builder

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files
COPY Cargo.toml ./

# Copy source code
COPY . .

# Build the application
RUN cargo build --release

FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copy the binary from builder
COPY --from=builder /app/target/release/navigation-backend /app/navigation-backend
COPY --from=builder /app/migrations /app/migrations

EXPOSE 3001

CMD ["./navigation-backend"]

