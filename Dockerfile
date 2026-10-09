FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run check && pnpm run test && pnpm run build
RUN pnpm prune --prod

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/haoch1/lightsail-panel" \
      org.opencontainers.image.title="Lightsail Panel" \
      org.opencontainers.image.description="Self-hosted Amazon Lightsail management panel" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8090 DATA_DIR=/app/data
RUN mkdir /app/data && chown node:node /app/data
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/bin ./bin
COPY --from=build /app/scripts/verify-aws.mjs ./scripts/verify-aws.mjs
RUN chmod 755 /app/bin/lightsail-panel.mjs \
    && ln -s /app/bin/lightsail-panel.mjs /usr/local/bin/lightsail-panel
USER node
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["lightsail-panel", "--healthcheck"]
ENTRYPOINT []
CMD ["lightsail-panel"]
