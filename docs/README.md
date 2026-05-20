# ShareGrid Engineering Documentation Index

Welcome to the **ShareGrid** system design and architecture documentation library. 

This folder holds comprehensive architectural designs, schemas, specifications, and onboarding procedures for engineers, devops, and future hires. The project's structure has been separated into specialized documents for quick reference.

---

## 🗺️ Documentation Map

### 1. [High-Level Design (HLD)](file:///d:/Prorgram/CloneProject/Aman/sharegrid/docs/HLD.md)
*   Overall system topology, core component layout, HLD block flow diagrams, and individual component roles.
*   **Best for:** Technical stakeholders, product managers, and onboarding developers needing a system overview.

### 2. [Low-Level Design (LLD)](file:///d:/Prorgram/CloneProject/Aman/sharegrid/docs/LLD.md)
*   WebSocket protocol specifications, safety gate processing rules (locks, cooldowns, rate limits), real-time message structures, and transaction sequence diagrams.
*   **Best for:** Core developers modifying game logic, WebSockets, or real-time networking code.

### 3. [Database Schema & Persistence](file:///d:/Prorgram/CloneProject/Aman/sharegrid/docs/SCHEMA.md)
*   Entity Relationship (ER) diagrams, strict table metadata definitions, transactional indexing strategies, and automated idempotent bootstrap procedures.
*   **Best for:** Database administrators, backend engineers, and systems developers.

### 4. [Technology Stack Platform](file:///d:/Prorgram/CloneProject/Aman/sharegrid/docs/TECH_STACK.md)
*   Comprehensive technological choices table, architecture rationale justifications, and detailed production mapping platforms (Vercel, Render, Neon, Redis).
*   **Best for:** Architects, devops, and infrastructure managers.

### 5. [Developer Runbook & Setup Guide](file:///d:/Prorgram/CloneProject/Aman/sharegrid/docs/RUNBOOK.md)
*   Local setup walkthroughs, environment configurations, folder execution instructions, and code conventions guidelines.
*   **Best for:** New hires on day one setting up their local workspace.
