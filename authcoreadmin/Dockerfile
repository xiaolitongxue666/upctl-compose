FROM node:22-alpine AS builder

# Cache-buster: set BUILD_DATE to force re-fetch of latest AuthCoreAdmin
ARG BUILD_DATE
WORKDIR /app
RUN apk add --no-cache git && \
    git clone --depth 1 https://github.com/alchemy-studio/AuthCoreAdmin.git .

RUN corepack enable && corepack prepare pnpm@10 --activate && \
    pnpm install --no-frozen-lockfile

RUN mode=compose npx vite build

FROM nginx:alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
