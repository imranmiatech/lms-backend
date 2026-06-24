#!/bin/sh

set -e

echo "Checking environment..."

if [ -z "$DATABASE_URL" ]; then
    echo "WARNING: DATABASE_URL is not set"
else
    echo "DATABASE_URL found"
fi

echo "Generating Prisma Client..."

if ! npx prisma generate; then
    echo "WARNING: Prisma generate failed"
fi

echo "Running Prisma db push..."

if ! npx prisma db push; then
    echo "WARNING: Prisma db push failed"
    echo "Starting application anyway..."
fi

echo "Starting NestJS application..."

exec node dist/main.js
