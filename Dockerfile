FROM node:lts-alpine3.15 AS builder
ENV NODE_ENV=production
WORKDIR /usr/src/app
COPY ./src/ ./src/
COPY ./public/ ./public/
COPY package.json package-lock.json* tsconfig.json* tslint.json* .eslintrc.js* ./
RUN npm i --include=dev
RUN npm run build

FROM node:lts-alpine3.15
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app/build/ /usr/src/app/package.json* /usr/src/app/package-lock.json* ./
RUN npm install -g serve
CMD ["serve", "-s", "."]

