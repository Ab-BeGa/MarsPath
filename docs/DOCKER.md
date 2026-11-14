# Docker deployment — Jezero Traverse

The Docker image contains the **built React/TypeScript website** and the **committed compact Mars DEM and CTX assets**. It does **not** include an API server, database, Python planner, original large GeoTIFF, external NASA downloads or secrets.

## Prerequisites

- Docker Desktop on Windows (**Linux containers / WSL2 mode**) or Docker Engine on Linux.
- Docker Compose V2 (the command is docker compose).
- Internet during the initial image build for Docker Hub's node:22-alpine image and npm, unless already cached. The finished container can serve its bundled Mars assets without Internet.

## Run and update

From the repository root:

~~~bash
docker compose up --build -d
docker compose ps
~~~

Open **http://localhost:8080/**. The independent HTTP health endpoint is **http://localhost:8080/_health** and returns JSON with a status of ok.

~~~bash
docker compose logs --tail=100
docker compose down
~~~

After a teammate updates the repository:

~~~bash
git switch main
git pull --ff-only origin main
docker compose up --build -d
~~~

If port 8080 is occupied, edit **compose.yaml**, changing the **host-side** mapping to 127.0.0.1:8081:8080, and visit http://localhost:8081/. The default binding deliberately permits access from **this computer only**; review TLS, reverse-proxy and access policy before deploying publicly.

## Direct Docker commands

~~~bash
docker build -t jezero-traverse:local .
docker run --rm --name jezero-web --read-only --cap-drop ALL --security-opt no-new-privileges -p 127.0.0.1:8080:8080 jezero-traverse:local
~~~

The build has **two stages**:
1. **Builder:** node:22-alpine, npm ci, frontend unit tests and TypeScript/esbuild production build. The preprocessed public/data/jezero directory is copied to dist.
2. **Runtime:** node:22-alpine, no installed npm dependencies, just dist plus scripts/serve_static.mjs. Runs as an **unprivileged node user**, on port **8080**, with Docker health checks.

Compose enables read-only filesystem, removes Linux capabilities, disallows privilege escalation and uses an init process. No volume, environment secret, external GeoTIFF or Node/Python installation on the **host** is needed.

## Smoke and source integrity checks

Open the following URLs; all must succeed:

| URL path | Contents |
| --- | --- |
| / | HTML entry |
| /_health | Health JSON |
| /assets/main.js | Built React JS |
| /assets/main.css | Styles |
| /data/jezero/metadata.json | WKT, Mars CRS and source metadata |
| /data/jezero/heights.f32 | 75 × 75 Float32 values, 22,500 bytes |
| /data/jezero/mask.u8 | NoData mask |
| /data/jezero/ctx_ortho.png | Genuine 5 m optical tile |
| /data/jezero/ctx_ortho.json | CTX alignment and provenance |
| /data/jezero/checksums.sha256 | DEM file fingerprints |

You can verify the committed elevation data checksums inside the container:

~~~bash
docker compose exec web sh -c "cd /app/dist/data/jezero && sha256sum -c checksums.sha256"
~~~

**GitHub Actions:** .github/workflows/docker.yml builds the image in CI, starts a restricted container, checks HTTP health, HTML, JS, CSS, DEM/CTX assets, error responses (404/405) and real DEM SHA-256 checksums. The same builder executes Node tests, TypeScript typecheck and production bundle creation. This verifies the *software* deployment, not EVA field safety.

## What is not included in Docker

The original **90 MB** USGS DEM GeoTIFF and optional larger CTX orthomosaic GeoTIFF are deliberately excluded from Docker and Git. To compute fresh manual or A* routes, follow [the Python instructions](../README.md#generate-compatible-route-exports-with-python) on your computer. Upload the resulting direct and detour route_waypoints.json files in the browser. Their DEM SHA-256, Mars projection, endpoints and thresholds must match.

## Troubleshooting

| Error | Fix |
| --- | --- |
| Docker unavailable / permission denied | Start Docker Desktop or Docker Engine, check docker info |
| Windows image error | Switch Docker Desktop to **Linux containers** |
| Port 8080 in use | Change host port in compose.yaml to 8081 |
| Unhealthy or restarting | docker compose logs --tail=100; internal port remains 8080 |
| Blank map | Check HTTP 200 for /data/jezero/metadata.json and heights.f32; check browser console |
| CTX toggle disabled | Ensure ctx_ortho.png and ctx_ortho.json are committed and included in dist |
| npm ci/build fails | Check npm access, compatible Node 22 version and package-lock.json |
| Browser cannot upload routes | Docker only hosts the frontend; generate the two JSON files with Python separately |
