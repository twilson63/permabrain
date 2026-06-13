# HyperBEAM Device Development Environment
# Includes: Erlang/OTP 27+, rebar3 3.24+, Rust, Git, cmake
# Usage:
#   docker build -t ghcr.io/twilson63/hyperbeam-dev:latest .
#   docker run --rm ghcr.io/twilson63/hyperbeam-dev:latest erl -version
#
#   # Build a device package:
#   docker run --rm -v $(pwd):/work ghcr.io/twilson63/hyperbeam-dev:latest \
#     sh -c "cd /work && rebar3 device package"
#
#   # Run device tests:
#   docker run --rm -v $(pwd):/work ghcr.io/twilson63/hyperbeam-dev:latest \
#     sh -c "cd /work && rebar3 device test"
#
#   # Start a local node with devices loaded:
#   docker run --rm -it -p 8734:8734 -v $(pwd):/work ghcr.io/twilson63/hyperbeam-dev:latest \
#     sh -c "cd /work && rebar3 device local"

FROM debian:trixie-slim

ARG RUST_PROFILE=minimal

# Install build/runtime dependencies. Debian trixie ships Erlang/OTP 27,
# which matches HyperBEAM Forge's current recommended baseline and avoids
# a long source build in the dev image.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential autoconf m4 libncurses-dev libssl-dev \
    git curl pkg-config cmake unixodbc-dev xsltproc fop libxml2-utils \
    openssh-client ca-certificates \
    erlang-base erlang-dev erlang-crypto erlang-eunit erlang-inets \
    erlang-os-mon erlang-public-key erlang-runtime-tools erlang-ssl \
    erlang-syntax-tools erlang-tools rebar3 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Rust (minimal profile — needed for elmdb-rs NIF)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile ${RUST_PROFILE} --default-toolchain stable \
    && rm -rf /root/.rustup/toolchains/*/share/doc /root/.rustup/toolchains/*/lib/rustlib/src
ENV PATH="/root/.cargo/bin:${PATH}"

# Verify toolchain
RUN erl -version && rebar3 version && rustc --version && cargo --version && cmake --version | head -1 && git --version

# Install HyperBEAM Forge template
RUN git clone --depth 1 --branch edge https://github.com/permaweb/hyperbeam.git /tmp/hyperbeam \
    && cd /tmp/hyperbeam && ./install-template --branch edge \
    && cd / && rm -rf /tmp/hyperbeam

WORKDIR /work
CMD ["/bin/bash"]
