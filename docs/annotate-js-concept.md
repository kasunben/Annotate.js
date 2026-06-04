# Annotate.js
**A lightweight web annotation and comments library**
*Concept Paper — Phase 1*

---

## 1. The Problem

Reviewing documents collaboratively on the web is harder than it should be. The dominant tool — Google Docs — solves this well, but at the cost of privacy, vendor lock-in, and a heavyweight setup that does not work on arbitrary web pages.

Existing open source alternatives either require heavy self-hosted infrastructure, offer no inline annotation (only page-level comments), or are abandoned projects built on outdated stacks. There is no simple, drop-in solution that works on any HTML page without forcing developers to build a backend from scratch.

---

## 2. The Solution

Annotate.js is a lightweight JavaScript library that adds an annotation and comments sidebar to any HTML page via a single script tag — the same integration model used by analytics tools. Developers add one line of code. Their users get a collaborative review experience.

The system has two parts: a small frontend JS file served via CDN, and a minimal self-hosted backend that stores and serves comments. The developer supplies their own site ID and points it at their backend instance.

---

## 3. How It Works

### Integration
A developer adds a single script tag to their HTML document with a site ID attribute. The library injects a collapsible sidebar into the page without touching or modifying any existing DOM content.

### Annotations
A user selects any text on the page and clicks the prompt that appears. They type a comment, set a display name (stored in their browser for future sessions), and submit. The annotation is anchored to the selected text and appears in the sidebar.

### Comments and Replies
Other users visiting the same URL see all existing annotations in the sidebar. They can reply to any annotation, creating a threaded conversation attached to that specific piece of text — similar in experience to Google Docs comments.

### Identity
There are no user accounts in Phase 1. Each user sets a display name once, which is stored in their browser's local storage and reused automatically on subsequent visits. No login, no email, no password.

---

## 4. Architecture

### Frontend
- Single JS file, no framework dependencies
- Injected sidebar with collapsible UI
- Text selection listener for triggering annotation
- Display name stored in localStorage
- Fetches and posts comments via REST API

### Backend
- Node.js with SQLite — minimal footprint
- Five REST endpoints: list, create, reply, resolve, delete
- Comments keyed by site ID + page URL
- Self-hosted by the developer, runs as a single process
- No external database, no cloud dependency

---

## 5. What This Is Not

Annotate.js is not a real-time collaborative editor. It does not compete with Google Docs for document editing. It is a review and feedback layer that sits on top of any existing HTML page — a static site, a design prototype, an internal tool, or a documentation page.

It is also not a hosted SaaS product in Phase 1. The developer is responsible for running the backend. This keeps it fully private and under their control.

---

## 6. Target Users

- Developers who want to add document review to a static site or internal tool
- Design teams reviewing HTML prototypes without exporting to third-party tools
- Small teams doing invite-only content review without wanting Google's data handling
- Publishers or researchers annotating web content collaboratively

---

## 7. Phase 1 Scope

The first release is intentionally narrow. The goal is a working, stable core — not a feature-complete product.

**In scope:**
- Script tag integration with site ID configuration
- Collapsible sidebar injected over any HTML page
- Text selection to create an annotation
- Threaded replies on annotations
- Anonymous display name, persisted in localStorage
- Minimal self-hosted Node + SQLite backend

**Out of scope for Phase 1:**
- User authentication and accounts
- Real-time updates (polling only)
- Notifications
- Annotation anchoring to dynamic or frequently changing content
- Hosted cloud backend

---

## 8. Success Criteria

Phase 1 is considered complete when a developer can add the script tag to any static HTML page, a reviewer can select text and leave a comment, and a second reviewer on a different machine can see and reply to that comment — with zero accounts, zero third-party services, and no more than 15 minutes of backend setup.

---

*Annotate.js — Concept Paper v0.1*
