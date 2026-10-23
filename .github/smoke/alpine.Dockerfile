# A minimal musl system with the C++ runtime the musl binaries link, as install.sh asks for.
# Docker's official image from a mirror, which scripts/smoke-images.ts picks: Docker Hub rate-limits the pulls of shared CI runners.
ARG REGISTRY=public.ecr.aws/docker
FROM ${REGISTRY}/library/alpine:3.22
RUN apk add --no-cache libstdc++ libgcc
