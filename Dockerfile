FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts        # skip postinstall here

COPY . .
RUN npx prisma generate            # schema is now present
RUN npm run build

FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY --from=builder /app/prisma ./prisma

RUN npm ci --omit=dev --ignore-scripts   # skip postinstall here too
RUN npx prisma generate                  # schema is present

COPY --from=builder /app/dist ./dist
COPY docker-entrypoint.sh .
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]