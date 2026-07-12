# 🐳 Docker Full-Stack Demo

A containerized full-stack application built with **React + Vite** (frontend), **Node.js + Express** (backend), and **MySQL 8** (database), orchestrated with Docker Compose.

## 🗂️ Project Structure

```
my-docker-app/
├── frontend/          # React + Vite SPA (served by Nginx in production)
│   ├── Dockerfile     # Multi-stage: build → nginx serve
│   └── src/
├── backend/           # Node.js + Express REST API
│   ├── Dockerfile     # node:18-alpine
│   └── server.js
└── docker-compose.yml # Orchestrates all 3 services
```

## 🚀 Quick Start

> **Prerequisites**: Docker & Docker Compose installed. That's it — no Node.js or MySQL needed on your machine.

```bash
git clone <your-repo-url>
cd my-docker-app
docker-compose up --build
```

Then open:

| URL | Service |
|-----|---------|
| http://localhost:8080 | Frontend UI |
| http://localhost:3000 | Backend API root |
| http://localhost:3000/health | DB health check |
| http://localhost:3000/items | List all items |

## 📡 API Reference

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| `GET` | `/` | Backend liveness | 200 |
| `GET` | `/health` | Database connectivity | 200 / 500 |
| `GET` | `/items` | List all items | 200 |
| `POST` | `/items` | Create item `{ "name": "..." }` | 201 / 400 / 500 |

## 🔧 Environment Variables

Copy `.env.example` to `.env` to configure locally. All values are passed via `docker-compose.yml` — **never commit `.env` with real secrets**.

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `db` | Docker service name (internal DNS) |
| `DB_USER` | `appuser` | MySQL user |
| `DB_PASSWORD` | `apppassword` | MySQL password |
| `DB_NAME` | `appdb` | MySQL database name |
| `PORT` | `3000` | Backend listen port |

## 🛑 Stop & Clean Up

```bash
# Stop containers (data is preserved in the named volume)
docker-compose down

# Stop AND remove all data (volume deleted)
docker-compose down -v
```

## 📝 Notes

- MySQL data is stored in a Docker **named volume** (`db_data`), so it survives `docker-compose down`.
- The backend retries the DB connection up to 10 times with 3-second delays — MySQL takes a moment to initialise on first run.
- The frontend calls the backend directly at `http://localhost:3000` (baked in at build time via `VITE_API_URL`).
