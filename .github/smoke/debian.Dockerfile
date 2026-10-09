# A minimal glibc system with wget and no curl, to try the installer's fallback.
# Docker's official image from AWS's mirror: Docker Hub rate-limits the pulls of shared CI runners.
FROM public.ecr.aws/docker/library/debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates && rm -rf /var/lib/apt/lists/*
