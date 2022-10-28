FROM node:lts-alpine3.15 AS builder
ENV NODE_ENV=production
WORKDIR /usr/src/app
COPY ./src/ ./src/
COPY ./public/ ./public/
COPY package.json package-lock.json tsconfig.json tsconfig.node.json vite.config.ts .eslintrc.yml index.html ./
RUN npm i --include=dev
RUN npm run build

FROM node:lts-alpine3.15
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app/dist/ ./
RUN npm install -g serve
CMD ["serve", "-s", "."]

