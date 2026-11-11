#!/usr/bin/env bash
# Arranca el build "standalone" igual que lo haría un contenedor (PORT-06).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf .next/standalone/public .next/standalone/.next/static
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
exec node .next/standalone/server.js
