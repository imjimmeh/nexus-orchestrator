---
name: searxng-web-search
description: "Search the web via a self-hosted SearXNG instance. Use when a task needs current external information not in the workspace."
version: 1.0.0
tier: light
estimated_duration: 20 minutes
category: implementation
tags:
  - skill
prerequisites: []
metadata: {}
---

# SearXNG Web Search Skill

## Overview

This skill provides a JavaScript-based CLI client for searching the web via SearXNG — a privacy-respecting metasearch engine that aggregates results from multiple search providers.

## Usage

### Basic Search

```bash
node searxng_search.js "your search query here"
```

### With Options

```bash
node searxng_search.js "query" --engines duckduckgo,brave --safesearch 0
```

### Environment Variable

```bash
SEARXNG_URL=http://your-instance:port node searxng_search.js "query"
```

## Options

| Flag           | Description                   | Example                      |
| -------------- | ----------------------------- | ---------------------------- |
| `--engines`    | Comma-separated engine list   | `--engines duckduckgo,brave` |
| `--categories` | Search categories             | `--categories general,news`  |
| `--language`   | Language code (default: auto) | `--language en`              |
| `--safesearch` | 0=none, 1=moderate, 2=strict  | `--safesearch 1`             |

## Example Searches

```bash
# Search for programming info
node searxng_search.js "javascript async await tutorial"

# Search news
node searxng_search.js "latest tech news" --categories news

# Safe search for kids
node searxng_search.js "animals" --safesearch 2
```

## Resource Files

- `searxng_search.js` — Main search script

## Prerequisites

- TODO: Add Prerequisites content.

## Instructions

- TODO: Add Instructions content.

## Output Format

- TODO: Add Output Format content.
