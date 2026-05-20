# High-Level Design (HLD) — ShareGrid System Topology

This document details the global architectural topology, physical component routing boundaries, and macro-level design boundaries of the ShareGrid system.

---

## 1. System Topology Overview

ShareGrid runs on a **decoupled, real-time message-broadcast topology**. 

To maintain sub-10ms response times and achieve near-limitless read scaling, the server utilizes a **stateless processing gateway** with an **in-process memory state cache**. The state cache is backed by an asynchronous database persistence loop.

```mermaid
graph TD
    %% Frontend Layer
    subgraph Client [Client UI Layer (Vercel)]
        FE[Vanilla JS SPA]
        Canvas[HTML5 Canvas Render Engine]
        FE -->|Renders| Canvas
    end

    %% Web Gateway
    subgraph Gateway [Networking Layer]
        WS[WebSocket connection wss://]
        REST[REST API https://]
    end
    
    FE <-->|Real-time JSON Protocol| WS
    FE -->|Read-Only Queries| REST

    %% Backend Layer
    subgraph Server [Backend Engine Layer (Render)]
        Router[Message Router]
        Engine[Game Engine Logic]
        MemStore[(In-Memory State Store)]
        
        WS <--> Router
        REST -->|GET Endpoints| MemStore
        Router <--> Engine
        Engine <--> MemStore
    end

    %% Persistence Layer
    subgraph Storage [Persistence Layer]
        DB[(Neon DB PostgreSQL)]
        Redis[(Redis Client / Optional)]
    end

    Engine -->|Fire-and-Forget Writes| DB
    Engine <-->|Pub/Sub Scaling| Redis
    Engine -.->|Hydrate on Startup| DB
```

---

## 2. Component Subsystems Responsibilities

### 2.1 Client UI Layer (Vercel)
*   **Asset Serving:** Delivers highly-optimized, static assets (Vanilla HTML/CSS/JS) via Vercel's global Edge CDN networks.
*   **Canvas Render Engine:** Bypasses DOM bottlenecks by drawing coordinate states directly on a 2D Canvas context at 60 FPS.
*   **Network Client:** Maintains a single persistent secure WebSocket (`wss://`) pipe to the active backend instance, handles automatic exponential-backoff reconnects, and caches local credentials.

### 2.2 Networking Layer (Gateways)
*   **WebSockets (`ws`):** Serves as the primary transaction channel for all active state mutations (e.g. tile claim attempts).
*   **REST API (Express):** Serves read-only, non-real-time queries (e.g. `/api/stats`, `/api/history`, `/api/grid` fallback snapshots).

### 2.3 Backend Engine Layer (Render)
*   **Message Router:** Decodes, parses, and validates the packet integrity of incoming JSON frames.
*   **Game Engine Logic:** Evaluates spatial grid bounds, tests game-rule safety gates (locks, cooldowns, rate limits), and processes board capture states.
*   **In-Memory Store:** The absolute single-source-of-truth for real-time reads during server execution. Maintains users, cooldown indexes, active canvas grids, and transaction locks.

### 2.4 Persistence Layer (Neon DB & Redis)
*   **Neon DB (PostgreSQL):** The permanent SQL cold storage registry. Holds user registration logs, active grid layout schemas, and full historic action audit trails.
*   **Redis Cache:** Handles pub/sub broadcasts across multiple servers. If single-instance operations are running, the Redis module gracefully falls back to memory mode with no disruption to players.
