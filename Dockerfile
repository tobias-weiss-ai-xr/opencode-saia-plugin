# SAIA OpenCode Plugin — Docker Image
#
# Self-hosted OpenCode instance with SAIA plugin pre-installed.
# Usage:
#   docker build -t opencode-saia .
#   docker run -e SAIA_API_KEY=your_key opencode-saia

FROM node:20-alpine AS base
RUN apk add --no-cache curl jq bash git

WORKDIR /opencode

# Install OpenCode CLI
RUN npm install -g @opencode/cli

# Copy SAIA plugin
COPY src/ ./src/
COPY schema/ ./schema/
COPY .opencode/ ./.opencode/
COPY install.sh install.ps1 ./
COPY package.json LICENSE README.md FAQ.md ./

# Install plugin
RUN mkdir -p ~/.config/opencode/plugins/saia && \
    cp -r src/* ~/.config/opencode/plugins/saia/ && \
    chmod +x ~/.config/opencode/plugins/saia/generate-saia-config.sh && \
    chmod +x ~/.config/opencode/plugins/saia/copy-saia-config.sh

# Default command shows help
CMD ["opencode", "--help"]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD bash src/generate-saia-config.sh --incremental || exit 1
