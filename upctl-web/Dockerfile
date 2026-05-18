FROM node:22-alpine AS builder

# Cache-buster: set BUILD_DATE to force re-fetch of latest upctl-web
ARG BUILD_DATE
WORKDIR /app
RUN apk add --no-cache git && \
    git clone --depth 1 https://github.com/alchemy-studio/upctl-web.git .

# Patch: replace union_id login with username/password login
COPY patches/LoginView.vue src/views/LoginView.vue
COPY patches/user.ts src/store/user.ts
# Patch: project store needs top-level loading/list for GitHub CreateTicket template
COPY patches/project.ts src/store/project.ts

ENV VITE_UC_SERVER=""
ENV VITE_TS_SERVER=""
ENV VITE_HOST=localhost:8088
ENV VITE_WX_APP=""

RUN corepack enable && corepack prepare pnpm@10 --activate && \
    pnpm install --no-frozen-lockfile && \
    npx vite build

FROM nginx:alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
