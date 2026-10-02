# Project Instructions for Claude

## Purpose of This Document

This document provides **context and collaboration guidelines for AI coding assistants** working in the Tasklog repository.

It explains:

- the purpose of the project
- the development philosophy
- how AI should assist during development
- which documents define system rules

AI assistants should read this file before proposing or implementing changes.

---

# Project Overview

<!-- Project-Code: (not set) -->
<!-- Uncomment and set a short code (e.g. TL) to prefix plan filenames: TL-P9-task-completion.md -->
<!-- If not set, plans use plain naming: P9-task-completion.md -->

**Tasklog** is a self-hosted task management application built as a personal alternative to subscription-based task apps.

The project began from a simple frustration: paying for a Todoist subscription for functionality that could be implemented independently.

Rather than recreating a full productivity platform, Tasklog focuses on building a **simple, understandable task system** that evolves over time.

The project is also intended to demonstrate **iterative software evolution**, starting from a minimal system and gradually expanding its capabilities.

---

# Origin Story

Tasklog started as a minimal system to replace a paid todo application.

The goals were:

- avoid recurring SaaS subscriptions
- retain full ownership of task data
- build something understandable end-to-end
- evolve the system gradually rather than designing everything upfront

The system has four components as of v4.1: a .NET Web API backend, a Next.js frontend (which also hosts Sage, the AI companion, in an API route), a Node/TypeScript MCP server that exposes the API to claude.ai as a custom connector via OAuth 2.1 + Cloudflare Tunnel, and a small per-machine `watchman` agent that ships screen-activity samples to the API.
See `CHANGELOG.md` for history and `docs/architecture.md` for current structure.

---

# Development Philosophy

The development philosophy for Tasklog emphasizes clarity and gradual evolution.

Key principles:

### Simplicity First

The system should remain understandable by a single developer.

Avoid unnecessary complexity and frameworks unless they clearly improve the system.

---

### Clarity Over Cleverness

Prefer readable, explicit solutions over clever or overly abstract designs.

Future maintainability is more important than short-term optimization.

---

### Incremental Evolution

The system should evolve version by version.

Major changes should happen in clearly defined phases rather than large uncontrolled rewrites.

---

### Ownership of the System

The goal is to understand the entire system:

- backend
- frontend
- database
- deployment

Design decisions should support that goal.

---

# AI Collaboration Rules

AI assistants (such as Claude Code) should follow these collaboration rules when contributing to the repository.

### Propose Before Implementing

For non-trivial changes:

1. Explain the proposed approach briefly.
2. Outline the implementation plan.
3. Then generate code if appropriate.

Large architectural changes should not be implemented without discussion.

---

### Respect Project Structure

When generating code:

- follow the architecture rules defined in the architecture document
- respect repository structure
- place logic in the correct layer

Do not introduce new structures without justification.

---

### Avoid Unnecessary Frameworks

Do not introduce additional frameworks or libraries unless there is a clear benefit.

The system should remain lightweight and understandable.

---

### Ask Questions When Requirements Are Unclear

If a task is ambiguous:

- ask clarifying questions
- do not guess requirements

Clear understanding is preferred over rapid implementation.

---

# Architecture Awareness

**Always read `docs/architecture.md` before proposing or implementing changes.**

It defines the current system structure, layer responsibilities, API contract,
data model, and known limitations. It is the primary reference for any code work.

Also read before making changes:

- `docs/product-design.md` - what the product is, who it's for, feature rules
- `docs/engineering-guidelines.md` - patterns to follow, patterns to avoid

---

# Documentation Map

The project uses a layered documentation structure. Each folder has a specific role:

| Folder / file | Purpose | Updated by |
|---|---|---|
| `docs/architecture.md` | How the system is structured | `/document` |
| `docs/engineering-guidelines.md` | Patterns to follow, patterns to avoid | `/document` |
| `docs/product-design.md` | What the product is, who it's for, feature rules | `/document` |
| `docs/plans/` | What we're going to do (per feature) | `/create-plan`, `/execute` |
| `guides/` | How specific things were done, end to end | `/guides` |
| `docs/learnings/` | Timeless concepts that apply across projects | `/learnings` |
| `CHANGELOG.md` | User-facing changes per version | `/document`, `/ship` |
| `LESSONS.md` | What was learned during sessions, what to avoid | manual |
| `README.md` | Project overview for humans visiting the repo | `/document` |

**Rule of thumb when documenting work:**
- If it's project-specific and walks through how something was done, it's a **guide** in `guides/`.
- If it's a timeless concept that could apply to other projects (CORS, networking, build systems), it's a **learning** in `docs/learnings/`.
- If it's about the current system structure itself, it goes in `docs/architecture.md`.

`/document` is responsible for syncing the architecture/product/engineering docs and identifying when guides or learnings should be written. It does not write guides or learnings itself; it recommends them.

---

# Coding Preferences

Code generated for this project should follow these preferences:

Prefer:

- clear naming
- small focused classes
- modular services
- readable code

Avoid:

- overly complex abstractions
- large monolithic files
- mixing responsibilities across layers

Code should prioritize **maintainability and clarity**.

---

# Communication Style

When assisting with development tasks:

1. Explain the approach briefly.
2. Provide a short implementation plan for complex changes.
3. Highlight architectural impacts if relevant.
4. Ask questions when requirements are unclear.

The goal is collaborative development rather than automatic code generation.

---

# Final Guideline

Tasklog is intended to be:

- understandable
- maintainable
- incrementally evolving

Prefer solutions that are:

- simple
- modular
- aligned with the project philosophy

If a change affects system architecture or project structure, highlight the impact before implementing it.

---