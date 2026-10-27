FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node . .
RUN npm ci --ignore-scripts --omit=dev && mkdir -p /app/data && chown node:node /app/data
ENV HOST=0.0.0.0 PORT=8765 DATA_DIR=/app/data
USER node
EXPOSE 8765
VOLUME /app/data
CMD ["node", "apps/api/src/index.js"]
