# EPIC: Nexus Orchestrator Web Management Interface

**Epic ID:** WEB-001  
**Status:** In Progress  
**Created:** 2026-03-24  
**Priority:** P0 - Critical

---

## 1. Executive Summary

### 1.1 Problem Statement
The Nexus Orchestrator API currently lacks a user-friendly management interface. Administrators and developers must interact with the system through raw API calls, CLI tools, or database queries. This creates a steep learning curve and limits adoption.

### 1.2 Solution Overview
Build a comprehensive React-based SPA providing an intuitive interface for managing all aspects of the Nexus Orchestrator platform.

### 1.3 Success Criteria
- Complete CRUD operations for all API resources
- Visual workflow editor with real-time YAML editing
- Real-time execution monitoring with live status updates
- Responsive design supporting desktop and tablet
- Under 2s initial page load time
- 100% TypeScript coverage with strict mode

---

## 2. Business Context

### 2.1 User Personas

**System Administrator (Alex)**
- DevOps Engineer managing infrastructure
- Weekly configuration updates, daily monitoring
- Pain Point: Needs CLI for basic configuration

**AI Developer (Sarah)**
- ML Engineer building workflows
- Daily workflow development and testing
- Pain Point: YAML editing without validation

**Product Manager (Mike)**
- Non-technical stakeholder
- Weekly review meetings
- Pain Point: Cannot access system without engineering help

### 2.2 Business Value
- Reduced Time-to-Value: Minutes instead of hours
- Lower Support Burden: Self-service configuration
- Improved Debugging: Visual execution logs
- Enhanced Collaboration: Non-technical access

---

## 3. Technical Architecture

### 3.1 Technology Stack

| Layer | Technology | Justification |
|-------|------------|---------------|
| Framework | React 18 | Industry standard, excellent TypeScript support |
| Language | TypeScript 5.3+ | Type safety, better IDE support |
| Build Tool | Vite 5.x | Fast HMR, optimized builds |
| State Management | TanStack Query | Server state sync, caching |
| Routing | React Router v6 | Declarative routing |
| Styling | TailwindCSS 3.4 | Utility-first, rapid development |
| UI Components | shadcn/ui | Accessible, customizable |
| Forms | React Hook Form + Zod | Performance, validation |
| Code Editor | Monaco Editor | VS Code editor, YAML support |
| Testing | Playwright | E2E testing, reliable |

### 3.2 Project Structure

```
apps/web/
├── src/
│   ├── components/
│   │   ├── layout/           # Layout, Sidebar, Header
│   │   ├── ui/               # shadcn/ui components
│   │   └── workflow/         # YamlEditor, WorkflowVisualizer
│   ├── hooks/                # TanStack Query hooks
│   ├── lib/
│   │   ├── api/              # Client, Types
│   │   └── utils.ts
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── providers/        # Providers, ProviderForm
│   │   ├── models/           # Models, ModelForm
│   │   ├── agents/           # AgentProfiles, AgentProfileForm
│   │   ├── secrets/          # Secrets, SecretForm
│   │   └── workflows/        # Workflows, WorkflowDetail, WorkflowEditor
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── e2e/                      # Playwright tests
├── Dockerfile
└── package.json
```

---

## 4. Functional Requirements

### 4.1 Dashboard (P0)
Display system overview with workflow counts, active runs, and recent activity.

### 4.2 LLM Providers Management (P0)
CRUD operations for AI providers (OpenAI, Anthropic) with auth configuration.

### 4.3 LLM Models Management (P0)
Configure available models with token limits and default assignments.

### 4.4 Agent Profiles Management (P0)
Create agent profiles with system prompts, model selection, and tier preferences.

### 4.5 Secrets Management (P0)
Secure storage for API keys and credentials with JSON format support.

### 4.6 Workflows List (P0)
View all workflows with execute, edit, and delete actions.

### 4.7 Workflow Editor (P0)
Monaco-based YAML editor with syntax highlighting and validation.

### 4.8 Workflow Detail (P0)
View workflow with visualization, YAML display, and execution history.

### 4.9 Settings (P1)
Configure API connection and authentication tokens.

---

## 5. Implementation Plan

### Phase 1: Foundation
- Task 0: Initialize project with Vite, React, TypeScript
- Task 1: Set up API client and TypeScript types
- Task 2: Create TanStack Query hooks
- Task 3: Build shadcn/ui component library
- Task 4: Create layout with sidebar navigation

### Phase 2: Core Pages
- Task 5: Dashboard with stats and activity
- Task 6: Providers management page
- Task 7: Models management page
- Task 8: Agent profiles management page
- Task 9: Secrets management page

### Phase 3: Workflow Management
- Task 10: Workflows list page
- Task 11: Workflow editor with Monaco
- Task 12: Workflow detail with visualization

### Phase 4: Integration
- Task 13: Settings page
- Task 14: Docker integration
- Task 15: E2E testing setup
- Task 16: Documentation

---

## 6. API Dependencies

All pages depend on existing Nexus API endpoints:
- GET/POST/PATCH/DELETE /ai-config/providers
- GET/POST/PATCH/DELETE /ai-config/models
- GET/POST/PATCH/DELETE /ai-config/agent-profiles
- GET/POST/PATCH/DELETE /ai-config/secrets
- GET/POST/PUT/DELETE /workflows
- POST /workflows/:id/execute
- GET /workflows/runs/:runId

---

## 7. Testing Strategy

- Unit tests: Vitest for utilities and hooks
- Integration tests: React Testing Library for components
- E2E tests: Playwright for critical user flows
- Visual regression: Storybook or Chromatic (optional)

---

## 8. Deployment

- Development: `npm run dev` (Vite dev server)
- Production: Docker container with Nginx
- Environment variables: VITE_API_URL for API endpoint
