# Plan 3: Docker + GitHub Actions CI

## Goal

Match the original nanobot's Docker setup with two Compose services + GitHub Actions CI.

## Files to Create

### 1. `Dockerfile`

Single-stage Node.js build:
- Base: `node:22-slim`
- Install production deps, build TypeScript
- Entrypoint: `node dist/index.js`
- Default command: `--channel all` (runs all enabled channels)

### 2. `docker-compose.yml`

Two services matching original nanobot:

**nanobotts-gateway** (production — long-running multi-channel server):
- Runs all channels (CLI disabled, Telegram + future channels)
- Resource limits: 1 CPU, 1GB memory
- Restart: always
- Volume: `~/.nanobotts:/app/data` (persists config, sessions, memory)
- Env file: `.env`

**nanobotts-cli** (development — interactive terminal):
- Interactive mode (`stdin_open`, `tty`)
- Runs CLI channel only
- Same volume mount for shared data
- No restart policy

### 3. `.dockerignore`

Exclude: `node_modules`, `dist`, `.env`, `data`, `.git`, `tests`, `*.md`

### 4. `.github/workflows/ci.yml`

- Trigger: push/PR to main
- Steps: checkout → setup Node 22 → npm ci → tsc --noEmit → npm test

## Usage

```bash
# First time: interactive setup
docker compose run --rm nanobotts-cli

# Run as always-on server (Telegram etc.)
docker compose up -d nanobotts-gateway
docker compose logs -f nanobotts-gateway

# Stop
docker compose down
```

## Verification

1. `docker compose build` — builds without errors
2. `docker compose run --rm nanobotts-cli` — starts interactive CLI
3. `docker compose up -d nanobotts-gateway` — runs in background
4. Push branch → GitHub Actions runs tests
