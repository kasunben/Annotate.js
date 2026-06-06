# Stage 1: build annotate.min.js
FROM node:23-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY assets/js/ assets/js/
RUN npm run build

# Stage 2: production runtime
FROM node:23-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server/ server/
COPY assets/ assets/
COPY demo/ demo/
COPY --from=builder /app/annotate.min.js ./
RUN mkdir -p server/data
EXPOSE 3000
VOLUME /app/server/data
CMD ["node", "server/index.js"]
