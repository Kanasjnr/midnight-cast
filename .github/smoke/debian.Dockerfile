# A minimal glibc system with wget and no curl, to try the installer's fallback.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates && rm -rf /var/lib/apt/lists/*
