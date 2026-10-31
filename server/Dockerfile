# Chat API + hosted Okta MCP gateway. Build from the repo root:
#   docker build -f server/Dockerfile -t oktamax-server .
FROM node:24-bookworm-slim

# Okta's MCP server (Python), installed once at build time and pinned: the
# gateway relies on its keyring and OKTA_SCOPES behaviour.
COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /uvx /usr/local/bin/
ENV UV_TOOL_DIR=/opt/uv/tools \
    UV_TOOL_BIN_DIR=/usr/local/bin \
    UV_PYTHON_INSTALL_DIR=/opt/uv/python
RUN uv tool install --python 3.13 okta-mcp-server==1.1.7

WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY extension/package.json extension/
RUN npm ci --workspace @oktamax/server --include-workspace-root --ignore-scripts

COPY tsconfig.base.json ./
COPY shared shared
COPY server server

ENV NODE_ENV=production \
    PORT=8787 \
    OKTA_MCP_COMMAND=okta-mcp-server \
    OKTA_MCP_ARGS=""
USER node
WORKDIR /app/server
EXPOSE 8787
CMD ["npx", "vpx", "src/index.ts"]
