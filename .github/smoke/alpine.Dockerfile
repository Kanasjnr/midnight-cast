# A minimal musl system with the C++ runtime the musl binaries link, as install.sh asks for.
FROM alpine:3.22
RUN apk add --no-cache libstdc++ libgcc
