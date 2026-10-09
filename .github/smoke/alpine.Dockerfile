# A minimal musl system with the C++ runtime the musl binaries link, as install.sh asks for.
# Docker's official image from AWS's mirror: Docker Hub rate-limits the pulls of shared CI runners.
FROM public.ecr.aws/docker/library/alpine:3.22
RUN apk add --no-cache libstdc++ libgcc
