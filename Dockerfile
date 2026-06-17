# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
# Prisma precisa de openssl/libssl no Alpine
RUN apk add --no-cache openssl libc6-compat
COPY package*.json ./
RUN npm install
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl libc6-compat
COPY package*.json ./
RUN npm install --omit=dev
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=build /app/dist ./dist
EXPOSE 3000
# Aplica migrações e sobe o servidor
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
