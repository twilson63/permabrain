# HyperBEAM Device Development Environment
# Includes: Erlang/OTP 27, rebar3 3.24+, Rust, Git, cmake
# Usage:
#   docker build -t ghcr.io/twilson63/hyperbeam-dev:latest .
#   docker push ghcr.io/twilson63/hyperbeam-dev:latest
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

ARG ERLANG_VERSION=27
ARG REBAR3_VERSION=3.24.0
ARG RUST_PROFILE=minimal

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential autoconf m4 libncurses-dev libssl-dev \
    git curl pkg-config cmake unixodbc-dev xsltproc fop libxml2-utils \
    openssh-client ca-certificates \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Build Erlang/OTP from source (ensures compatibility)
ENV CFLAGS="-O2 -Wno-error=incompatible-pointer-types"
RUN cd /tmp && git clone --depth 1 --branch maint-${ERLANG_VERSION} https://github.com/erlang/otp.git \
    && cd otp \
    && ./configure \
        --without-javac --without-debugger --without-observer --without-wx \
    && make -j$(nproc) \
    && make install \
    && cd / && rm -rf /tmp/otp

# Install rebar3 from source
RUN cd /tmp && git clone --depth 1 --branch ${REBAR3_VERSION} https://github.com/erlang/rebar3.git \
    && cd rebar3 && ./bootstrap && mv rebar3 /usr/local/bin/ \
    && cd / && rm -rf /tmp/rebar3

# Install Rust (minimal profile — needed for elmdb-rs NIF)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile ${RUST_PROFILE} --default-toolchain stable \
    && rm -rf /root/.rustup/toolchains/*/share/doc /root/.rustup/toolchains/*/lib/rustlib/src
ENV PATH="/root/.cargo/bin:${PATH}"

# Verify toolchain
RUN erl -version && rebar3 version && rustc --version && cargo --version && cmake --version | head -1 && git --version

# Install HyperBEAM Forge template
RUN git clone --depth 1 --branch edge https://github.com/permaweb/HyperBEAM.git /tmp/hyperbeam \
    && cd /tmp/hyperbeam && ./install-template --branch edge \
    && cd / && rm -rf /tmp/hyperbeam

# Set up working directory
WORKDIR /work

# Default shell
CMD ["/bin/bash"]