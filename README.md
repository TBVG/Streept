# Streept

> **Navigation that doesn't just tell you where to turn — it shows you how to understand the road ahead.**

Streept is a **web-first navigation platform** built around a simple idea: traditional navigation treats the world like a flat line on a map. Streept is designed to turn that route into a **spatial, contextual experience**.

It combines turn-by-turn routing, lane and junction intelligence, live community information, predictive spatial context, and an immersive first-person 3D view that can appear automatically when a maneuver needs more visual understanding.

**The goal:** make navigation feel less like following a line and more like having the road explained to you at the moment it matters.

---

## 🚗 Why Streept?

Most navigation interfaces answer one question:

**“Where do I go next?”**

Streept is being built to answer a bigger set of questions:

- Which lane should I be thinking about before the turn?
- Is this junction simple or confusing?
- What does the road ahead actually look like from the driver's perspective?
- When should the interface switch from a normal map to a more immersive view?
- What has happened on this road before?
- What information is actually relevant to me right now?

The result is a navigation system designed around **driver understanding**, not simply route geometry.

---

## ✨ What Streept can do

### 🗺️ Turn-by-turn navigation

- Route from a starting point to a destination.
- Multiple route alternatives when the routing provider supplies them.
- Turn-by-turn maneuver guidance.
- Distance and maneuver presentation designed for driving.
- Heading-aware vehicle positioning.
- Automatic rerouting support.

### 🛣️ Lane intelligence

Streept can reason about the physical road and lane geometry available in its map data, including:

- current-lane matching
- lane continuity
- lane splits and merges
- destination-lane planning
- lane-change timing
- directional carriageways
- turn restrictions
- complex intersections

Where the underlying map data is detailed enough, Streept can use that information to make guidance more specific than a basic “turn left” instruction.

### 🏙️ Automatic 2D → 3D navigation

This is one of Streept's defining ideas.

Instead of forcing the driver to manually switch between map modes, Streept can decide when a maneuver or junction deserves additional spatial context.

The navigation experience can transition from:

**normal 2D map → preparation view → first-person 3D view**

The immersive view is designed around the driver's approach to the road, rather than simply showing a generic overhead 3D map.

It can include:

- 3D road geometry
- lane geometry
- buildings
- junction structure
- route highlighting
- live scene context
- predictive scene preparation
- adaptive rendering quality

### 🧠 Spatial intelligence

Streept maintains a spatial intelligence layer around the route.

It combines signals such as:

- road geometry
- junction complexity
- lane information
- navigation outcomes
- hazards
- community observations
- temporal patterns
- confidence and freshness

The system is designed to become more useful as it accumulates **coarse navigation outcomes and road-level knowledge**, while avoiding the need to store raw GPS traces for the local learning loop.

### 📍 Community road intelligence

Users can report things happening on the road, including:

- hazards
- police activity
- construction
- accidents
- traffic problems
- closed lanes

Reports can be confirmed or dismissed by other users, allowing the system to maintain a time-limited confidence in community information.

### 🅿️ Parking intelligence

Streept includes parking-state intelligence designed around **detection rather than fake reservations**.

The system can infer parking activity from movement/location behavior near mapped parking areas and update the surrounding navigation experience accordingly.

### 📡 Live updates

The backend supports real-time WebSocket updates for relevant road/community activity, including changes to reports and parking/traffic-related state.

Updates are geographically filtered so the client does not need to receive every event happening everywhere.

### 📱 Account-free navigation

The normal web navigation experience does not require users to create an account.

The project still contains authenticated backend capabilities for API clients and administrative operations where needed.

### 📴 Offline-aware navigation

Streept is designed to degrade gracefully when connectivity disappears.

An already-loaded route can continue to provide local turn-by-turn guidance. Cached route data and offline map-tile infrastructure are also included, while features that genuinely require a network — such as search, rerouting, and live community updates — pause and recover rather than pretending they still have connectivity.

### 🏷️ Spatial advertising concept

Streept also explores a future advertising layer where roadside advertising can be represented as spatial objects in the navigation world.

In the current product exploration, billboards can appear as 3D roadside panels near the route. This is intentionally treated as a future product surface, with moderation and commercial controls required before a real advertising marketplace.

### 🧭 Lightweight camera guidance

The web app includes a lightweight camera-based directional mode with compass/arrow guidance.

It is **not** presented as full ARKit/ARCore-grade augmented reality. True road-anchored AR would require a native mobile implementation and additional platform capabilities.

---

## 🧩 What makes the project different

Streept is not being built as another thin map wrapper.

Its long-term product direction is a **navigation intelligence layer attached to the physical road network**.

The architecture is intended to connect:

**Route → Road → Lane → Junction → Scene → Context → Outcome → Learning**

That creates a foundation for progressively richer navigation rather than simply adding more buttons to a map.

The project is deliberately being developed as a real product architecture, with real routing, database persistence, WebSockets, rate limiting, tests, offline state, scene streaming, and production-oriented boundaries rather than a static visual demo.

---

## 🏗️ Technology

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite |
| 2D maps | Leaflet |
| Immersive 3D | CesiumJS |
| Backend | Rust + Axum |
| Database | PostgreSQL + PostGIS |
| Routing | OSRM-compatible routing |
| Geocoding | Photon / OpenStreetMap ecosystem |
| Real-time | WebSockets + Tokio broadcast |
| Offline client state | IndexedDB + Service Worker + Cache API |
| Containers | Docker Compose |

The project also contains infrastructure for self-hosted routing, scene-tile sharding, provider fallback, adaptive 3D rendering, and privacy-conscious on-device learning.

---

## 🖥️ Run Streept locally

The easiest way to experiment with the current build is Docker.

### Requirements

- Windows, macOS, or Linux
- Docker Desktop / Docker Engine
- Docker Compose

### Start the application

From the project root:

```bash
docker compose up --build
```

Then open:

```text
http://localhost:3000
```

The backend runs separately behind the frontend and communicates with PostgreSQL/PostGIS.

For more detailed setup instructions, see:

- `DOCKER_QUICKSTART.md`
- `SETUP.md`
- `IMMERSIVE_NAVIGATION.md`
- `OFFLINE_AND_DATA_OPERATIONS.md`

---



The project is being kept provider-neutral so that free-tier services can be used while Streept is small, with self-hosted alternatives available as the project grows.

**Important:** “free” applies to the initial prototype/public-testing stage. Map tiles, routing, traffic, 3D data, bandwidth, and database usage can eventually exceed free-tier limits. Provider terms and data licenses must also be respected.

A custom domain is optional. Streept can initially be tested through a free hosting URL.

---

## 🗺️ Maps, routing and data

Streept is designed to avoid locking the product to one commercial mapping provider.

The current web prototype uses a public Esri raster basemap and OSRM-compatible routing. The project also contains a path for self-hosted OSRM using regional OpenStreetMap data.

For production deployment, verify the current terms for every external provider before caching, redistributing, or commercially using its data.

OpenStreetMap-derived data has its own licensing and attribution requirements and is not owned by Streept.

---

## 🔐 Privacy and learning

The local learning system is intentionally conservative.

The browser can record coarse navigation outcomes such as:

- maneuver completed
- maneuver missed
- hazard observed
- lane misalignment

The local learning model uses these coarse observations rather than requiring a raw GPS history or a server-side personal profile.

This is a product direction and architecture choice, not a claim that the entire Streept platform is privacy-perfect or that every future feature will use the same data model.

---

## ⚖️ License and intellectual property

The Streept source code is licensed under **GNU AGPL v3 or later**. See `LICENSE`.

The project separately identifies:

- Streept trademarks and branding
- third-party libraries and their licenses
- OpenStreetMap/ODbL data obligations
- original datasets
- potential proprietary algorithms/IP
- patents and other separately protected intellectual property

See `COPYRIGHT.md`, `TRADEMARKS.md`, `CONTRIBUTING.md`, and `LICENSES/THIRD-PARTY-NOTICES`.

Free hosting does **not** require changing the AGPL license.

Before a public commercial launch, perform a final third-party asset, map-data, and provider-terms audit.

---



