#!/bin/bash
# Build and publish the HyperBEAM Device Development image
#
# Usage:
#   ./scripts/build-dev-image.sh              # Build for current arch
#   ./scripts/build-dev-image.sh --push       # Build and push to GHCR
#   ./scripts/build-dev-image.sh --multiarch # Build for amd64 + arm64

#!/bin/bash
# Build and publish the HyperBEAM Device Development image
#
# Usage:
#   ./scripts/build-dev-image.sh              # Build for current arch
#   ./scripts/build-dev-image.sh --push       # Build and push to GHCR
#   ./scripts/build-dev-image.sh --multiarch  # Build for amd64 + arm64

set -euo pipefail

cd "$(dirname "$0")/.." || exit 1
ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || echo "$(cd "$(dirname "$0")/../.." && pwd)")"

IMAGE_NAME="ghcr.io/twilson63/hyperbeam-dev"
VERSION="${1:-latest}"

echo "Building ${IMAGE_NAME}:${VERSION} from ${ROOT_DIR}..."

# Check for Docker buildx
if ! docker buildx version &>/dev/null; then
    echo "Error: docker buildx not available. Install buildx first."
    exit 1
fi

# Create buildx builder if needed
BUILDER="hyperbeam-dev-builder"
if ! docker buildx inspect "$BUILDER" &>/dev/null; then
    echo "Creating buildx builder..."
    docker buildx create --name "$BUILDER" --use
fi

case "${2:-}" in
    --push)
        echo "Building and pushing for amd64..."
        docker buildx build --platform linux/amd64 \
            --tag "${IMAGE_NAME}:${VERSION}" \
            --push \
            --file hb-forge/Dockerfile \
            "${ROOT_DIR}"
        ;;
    --multiarch)
        echo "Building and pushing multi-arch (amd64 + arm64)..."
        docker buildx build --platform linux/amd64,linux/arm64 \
            --tag "${IMAGE_NAME}:${VERSION}" \
            --push \
            --file hb-forge/Dockerfile \
            "${ROOT_DIR}"
        ;;
    *)
        echo "Building locally..."
        docker buildx build --platform linux/amd64 \
            --tag "${IMAGE_NAME}:${VERSION}" \
            --load \
            --file hb-forge/Dockerfile \
            "${ROOT_DIR}"
        echo ""
        echo "Built: ${IMAGE_NAME}:${VERSION}"
        echo ""
        echo "Usage:"
        echo "  docker run --rm -v \$(pwd)/hb-forge:/work ${IMAGE_NAME}:${VERSION} sh -c 'cd /work && rebar3 device package'"
        echo "  docker run --rm -v \$(pwd)/hb-forge:/work ${IMAGE_NAME}:${VERSION} sh -c 'cd /work && rebar3 device test'"
        echo "  docker run --rm -it -p 8734:8734 -v \$(pwd)/hb-forge:/work ${IMAGE_NAME}:${VERSION} sh -c 'cd /work && rebar3 device local'"
        ;;
esac
