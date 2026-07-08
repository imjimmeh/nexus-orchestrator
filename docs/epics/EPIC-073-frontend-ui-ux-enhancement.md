# EPIC-073: Frontend UI/UX Enhancement and Visual Refresh

Status: Proposed
Priority: P2
Created: 2026-04-11
Last Updated: 2026-04-11
Owner: TBD
Theme: User experience, visual design, and developer productivity

---

## 1. Executive Summary

The Nexus Orchestrator web interface, while functionally comprehensive, suffers from a monochromatic visual design, information-dense layouts, and navigation friction that impacts user productivity and satisfaction. This epic delivers a comprehensive UI/UX enhancement focused on visual polish, improved navigation, and streamlined workflows.

This epic delivers:

1. **Visual Design System Enhancement** - Richer color palette, better typography, elevation system, and improved spacing
2. **Navigation and Wayfinding** - Command palette, breadcrumbs, collapsible sidebar sections, and contextual navigation
3. **Dashboard Redesign** - Interactive stat cards with trends, activity feed, quick actions, and project previews
4. **Kanban Board Improvements** - Redesigned cards with metadata, swimlanes, WIP limits, and better drag-drop feedback
5. **Active Session Workspace Redesign** - Focus modes, prominent status communication, and improved information architecture
6. **Forms and Micro-interactions** - Autosave, smart validation, toast notifications, and polished loading states

The net-new work builds on existing foundations:
- React 18 + TypeScript + Vite frontend stack
- shadcn/ui component library with Tailwind CSS
- React Query for data fetching
- React Router for navigation
- @hello-pangea/dnd for drag-and-drop

---

## 2. Context and Codebase Analysis

### 2.1 Existing capabilities we can leverage

1. **Solid component architecture**
   - shadcn/ui provides consistent, accessible base components
   - Well-organized component structure in `apps/web/src/components/`
   - TypeScript with full type safety coverage
   - References:
     - `apps/web/src/components/ui/`
     - `apps/web/src/components/layout/`

2. **CSS variable-based theming**
   - Light and dark mode support via CSS custom properties
   - Tailwind CSS with custom color tokens
   - Easy to extend with new color scales
   - References:
     - `apps/web/src/index.css`
     - `apps/web/tailwind.config.js`

3. **Modern data fetching patterns**
   - React Query for server state management
   - Loading states and error handling patterns established
   - References:
     - `apps/web/src/hooks/`
     - `apps/web/src/lib/api/`

4. **Drag-and-drop infrastructure**
   - @hello-pangea/dnd already integrated for kanban
   - References:
     - `apps/web/src/pages/kanban/KanbanBoard.tsx`

### 2.2 Gaps EPIC-073 must close

1. **Monochromatic color scheme:**
   - Heavy reliance on grays creates bland appearance
   - No accent colors for brand personality
   - Status colors are subtle and hard to distinguish
   - Missing semantic color tokens (success, warning, info)

2. **Navigation overload:**
   - Sidebar has 14 items in flat list across 2 groups
   - No command palette or global search
   - No breadcrumbs for deep navigation
   - No way to bookmark or access recent pages quickly

3. **Static dashboard:**
   - Stat cards show only numbers without trends or context
   - No activity feed or real-time updates
   - Missing quick actions for common tasks
   - Project cards lack preview information

4. **Dense kanban cards:**
   - Cards show only title and status
   - No priority indicators, assignee avatars, or progress bars
   - Missing WIP limits per column
   - No swimlane support for grouping

5. **Cramped active session workspace:**
   - Information density too high
   - Tab switching disrupts flow
   - Status not prominently displayed
   - No focus modes for different activities

6. **Basic form experience:**
   - No autosave functionality
   - Error messages lack helpful guidance
   - No toast notifications for feedback
   - Loading states are generic skeletons

### 2.3 Design constraints to preserve

1. Preserve dark mode support and theme switching.
2. Preserve accessibility (WCAG 2.1 AA compliance).
3. Preserve responsive layout behavior.
4. Maintain backward compatibility with existing URL routes.
5. Keep bundle size reasonable (code-split heavy features).
6. Maintain type safety throughout all changes.

---

## 3. Goals

1. Implement a richer, more vibrant color system with semantic tokens for better visual hierarchy.
2. Reduce navigation friction through command palette, breadcrumbs, and improved sidebar organization.
3. Transform the dashboard into an actionable command center with trends, feeds, and quick actions.
4. Enhance kanban board density and information richness without overwhelming users.
5. Redesign active session workspace with focus modes and prominent status communication.
6. Add polish through micro-interactions, toast notifications, smart forms, and improved loading states.
7. Maintain or improve accessibility and performance metrics.

---

## 4. Non-Goals

1. Rebuilding the entire component library from scratch.
2. Adding new major features (e.g., new page types, new workflows).
3. Mobile app development or PWA features.
4. Real-time collaborative editing features.
5. Custom theme builder or user-defined themes.
6. Animation-heavy transitions that impact performance.

---

## 5. Scope Overview

This epic is delivered in six workstreams:

1. **WS1: Visual Design System Enhancement**
2. **WS2: Navigation and Wayfinding**
3. **WS3: Dashboard Redesign**
4. **WS4: Kanban Board Improvements**
5. **WS5: Active Session Workspace Redesign**
6. **WS6: Forms, Micro-interactions, and Polish**

---

## 6. Workstreams and Detailed Tasks

### WS1: Visual Design System Enhancement

Objective: Establish a richer, more vibrant visual foundation.

#### Task E073-001: Implement enhanced color palette

Description:
Expand the color system with a vibrant primary color, semantic tokens, and accent colors while maintaining dark mode support.

Acceptance Criteria:

1. Update CSS variables in `apps/web/src/index.css`:
   - New primary: `hsl(221.2 83.2% 53.3%)` (vibrant blue)
   - Add primary scale: 50, 100, 200, 300, 400, 500, 600, 700, 800, 900
   - Add semantic tokens: success, warning, info, error
   - Add accent colors: purple, green, orange

2. Update Tailwind config to include new color tokens:
   - Primary scale accessible via `bg-primary-50` through `bg-primary-900`
   - Semantic colors: `bg-success`, `text-warning`, etc.

3. Update shadcn/ui components to use new colors where appropriate.

4. Verify dark mode colors maintain WCAG 2.1 AA contrast ratios.

References:

1. `apps/web/src/index.css`
2. `apps/web/tailwind.config.js`
3. `apps/web/src/components/ui/`

#### Task E073-002: Add elevation and shadow system

Description:
Create a comprehensive shadow scale for depth and elevation effects.

Acceptance Criteria:

1. Define shadow scale in CSS:
   ```css
   --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
   --shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
   --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
   --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
   --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
   ```

2. Add Tailwind classes for shadows:
   - `shadow-sm`, `shadow-md`, `shadow-lg`, `shadow-xl`
   - `shadow-hover` for interactive elements

3. Apply shadows to components:
   - Cards: subtle shadow with lift on hover
   - Dropdowns/menus: `shadow-lg`
   - Modals: `shadow-xl`
   - Sticky headers: `shadow-sm`

4. Ensure shadows work in both light and dark modes.

References:

1. `apps/web/tailwind.config.js`
2. `apps/web/src/components/ui/card.tsx`
3. `apps/web/src/components/ui/dialog.tsx`

#### Task E073-003: Improve typography system

Description:
Enhance typography for better readability and visual hierarchy.

Acceptance Criteria:

1. Increase base line-height from 1.5 to 1.6 for body text.

2. Adjust muted foreground color for better contrast:
   - Light mode: `--muted-foreground: 215.4 16.3% 40%` (was 46.9%)
   - Dark mode: Current value acceptable

3. Add type scale between xl and 3xl:
   - `text-2xl` (24px) for section headings
   - Update heading hierarchy: h1=3xl, h2=2xl, h3=xl, h4=lg

4. Use heavier font weights for emphasis:
   - Section headings: font-semibold (600)
   - Labels: font-medium (500)
   - Body: font-normal (400)

5. Ensure all typography changes maintain accessibility standards.

References:

1. `apps/web/src/index.css`
2. `apps/web/tailwind.config.js`

#### Task E073-004: Implement spacing and layout improvements

Description:
Standardize and increase spacing for better visual breathing room.

Acceptance Criteria:

1. Increase card padding:
   - Standard cards: 24px → 32px
   - Compact cards (tables/lists): Keep 24px

2. Standardize section spacing:
   - Between major sections: 48px (space-y-12)
   - Between related elements: 24px (space-y-6)
   - Between tight groups: 16px (space-y-4)

3. Add page-level padding consistency:
   - Main content area: `p-6` (current) → consider `p-8` on larger screens
   - Use responsive padding: `p-6 lg:p-8`

4. Update Layout component to support consistent spacing.

References:

1. `apps/web/src/components/layout/Layout.tsx`
2. `apps/web/src/components/ui/card.tsx`

---

### WS2: Navigation and Wayfinding

Objective: Reduce navigation friction and improve wayfinding.

#### Task E073-005: Implement command palette (Cmd+K)

Description:
Add a global command palette for search, navigation, and quick actions.

Acceptance Criteria:

1. Install and configure `cmdk` library:
   ```bash
   npm install cmdk
   ```

2. Create `CommandPalette` component:
   - Triggered by Cmd+K (or Ctrl+K)
   - Search across pages, projects, workflows, work items
   - Recent items section
   - Quick actions (Create project, Start workflow, etc.)

3. Integrate into Layout component:
   - Global keyboard shortcut
   - Accessible from any page

4. Search functionality:
   - Fuzzy search across route names
   - Project name search
   - Workflow name search
   - Recent work items

5. Implement result categorization:
   - Pages
   - Projects
   - Workflows
   - Actions

References:

1. `apps/web/src/components/layout/Layout.tsx`
2. `apps/web/src/App.tsx` (route definitions)

#### Task E073-006: Add breadcrumb navigation

Description:
Implement breadcrumbs for deep navigation paths.

Acceptance Criteria:

1. Create `Breadcrumbs` component:
   - Shows hierarchical path: Projects > Project Name > Board
   - Each segment is clickable
   - Truncates long titles with ellipsis
   - Full title on hover

2. Integrate with React Router:
   - Parse current location
   - Map routes to breadcrumb labels
   - Handle dynamic segments (projectId, workItemId)

3. Add to Layout component below header:
   - Sticky positioning
   - Subtle background

4. Handle edge cases:
   - Dashboard (home) has no breadcrumbs
   - Deep paths show appropriate hierarchy
   - Dynamic IDs resolved to names

References:

1. `apps/web/src/components/layout/Layout.tsx`
2. `apps/web/src/App.tsx`

#### Task E073-007: Redesign sidebar with collapsible sections

Description:
Improve sidebar organization with collapsible sections and smart defaults.

Acceptance Criteria:

1. Make Configuration section collapsible:
   - Default state: collapsed
   - Remember user's preference
   - Smooth animation on expand/collapse

2. Add Favorites section:
   - Allow pinning frequently used pages
   - Persist to localStorage
   - Show at top of sidebar

3. Add Recents section:
   - Show last 5 visited pages
   - Auto-update on navigation
   - Deduplicate entries

4. Improve Work section:
   - Add count badges for Work Items
   - Add "live" indicator for Sessions
   - Group related items visually

5. Update Sidebar styling:
   - Better active state indication
   - Hover effects
   - Improved icon sizing

References:

1. `apps/web/src/components/layout/Sidebar.tsx`
2. `apps/web/src/stores/` (for persistence)

#### Task E073-008: Add keyboard shortcuts

Description:
Implement keyboard shortcuts for power users.

Acceptance Criteria:

1. Define keyboard shortcuts:
   - Cmd+K: Open command palette
   - Cmd+1-9: Navigate to favorites
   - Cmd+/: Show keyboard shortcuts help
   - Escape: Close modals/panels
   - Cmd+Enter: Submit forms

2. Create `KeyboardShortcuts` component:
   - Context provider for shortcut handling
   - Hook: `useKeyboardShortcut`

3. Create shortcuts help modal:
   - Accessible via Cmd+/
   - Categorized shortcuts
   - Visual key representations

4. Ensure shortcuts don't conflict with browser defaults.

5. Add visual hints in UI (e.g., "Cmd+K" in search placeholder).

References:

1. `apps/web/src/components/layout/Layout.tsx`
2. `apps/web/src/hooks/` (create new hook)

---

### WS3: Dashboard Redesign

Objective: Transform dashboard into an actionable command center.

#### Task E073-009: Redesign stat cards with trends

Description:
Enhance stat cards with sparklines, trends, and actionable context.

Acceptance Criteria:

1. Update StatCard component:
   - Add sparkline chart (mini trend line)
   - Show percentage change (up/down/neutral)
   - Color-code trends (green for up, red for down)
   - Add clickable action for drill-down

2. Install chart library:
   ```bash
   npm install recharts
   ```

3. Sparkline implementation:
   - 7-day trend data
   - Simple line chart, no axes
   - Color based on trend direction

4. Add trend calculation:
   - Compare current value to previous period
   - Show percentage and arrow icon

5. Make cards interactive:
   - Hover: lift effect
   - Click: navigate to detail view

References:

1. `apps/web/src/pages/Dashboard.tsx`
2. `apps/web/src/components/ui/card.tsx`

#### Task E073-010: Add activity feed widget

Description:
Create a real-time activity feed showing recent platform events.

Acceptance Criteria:

1. Create `ActivityFeed` component:
   - Timeline layout
   - Event types: workflow runs, work items created, agent completions
   - Icons and colors per event type
   - Timestamps (relative: "2m ago")

2. Data integration:
   - Use existing events/queries
   - Poll for updates (30s interval)
   - Show last 10 events

3. Visual design:
   - Timeline connector line
   - Event icons in colored circles
   - Expandable details
   - "View all" link to Events page

4. Empty state:
   - Friendly illustration
   - "No recent activity" message

References:

1. `apps/web/src/pages/Dashboard.tsx`
2. `apps/web/src/hooks/useWorkflows.ts`
3. `apps/web/src/pages/events/Events.tsx`

#### Task E073-011: Add quick actions section

Description:
Create a quick actions section for common tasks.

Acceptance Criteria:

1. Create `QuickActions` component:
   - Grid of action buttons
   - Icons and labels
   - Context-aware (show relevant actions)

2. Define quick actions:
   - Create Work Item
   - Start Standup Workflow
   - View Blocked Items
   - Resume Last Session
   - Create Project

3. Smart defaults:
   - "Resume Last Session" only shows if session exists
   - Context-aware (e.g., pre-select current project)

4. Visual design:
   - Card-based layout
   - Icon + label
   - Hover effects
   - Keyboard shortcuts

References:

1. `apps/web/src/pages/Dashboard.tsx`
2. `apps/web/src/components/workflow/WorkflowLaunchDialog.tsx`

#### Task E073-012: Enhance project previews

Description:
Improve project cards with more information and previews.

Acceptance Criteria:

1. Update `ProjectSummaryCard`:
   - Add project health score (0-100)
   - Show work item counts by status
   - Mini kanban preview (last 3 items per column)
   - Recent activity indicator

2. Health score calculation:
   - Based on blocked items, stale work, completion rate
   - Color-coded: red (<50), yellow (50-75), green (>75)

3. Mini kanban:
   - Show 3 most recent items per status
   - Color-coded priority dots
   - Expandable to full board

4. Quick actions on card:
   - Board, Sessions, Orchestration buttons (already exist)
   - Add "New Work Item" button

References:

1. `apps/web/src/components/projects/ProjectSummaryCard.tsx`
2. `apps/web/src/pages/projects/Projects.tsx`

---

### WS4: Kanban Board Improvements

Objective: Enhance kanban board information density and usability.

#### Task E073-013: Redesign work item cards

Description:
Redesign kanban cards to show more metadata and visual indicators.

Acceptance Criteria:

1. New card layout:
   ```
   ┌─────────────────────────────────────┐
   │ 🔴 P0  Fix checkout bug      [▓▓░░] │
   │                                     │
   │ Description truncated...            │
   │                                     │
   │ 👤 Avatar  📎 3  💬 5  ⏱️ 2d       │
   │ [Dev] [Bug] [Blocked]              │
   └─────────────────────────────────────┘
   ```

2. Add priority indicator:
   - Color-coded left border (red P0, orange P1, yellow P2, gray P3)
   - Priority badge

3. Add progress bar:
   - For in-progress items
   - Based on checklists or estimated vs actual

4. Add metadata row:
   - Assignee avatar
   - Attachment count
   - Comment count
   - Estimated time

5. Add tags/chips:
   - Category labels
   - Blocked indicator
   - Automation status

6. Truncate descriptions with expand option.

References:

1. `apps/web/src/pages/kanban/KanbanWorkItemCard.tsx`
2. `apps/web/src/pages/kanban/KanbanBoard.tsx`

#### Task E073-014: Add WIP limits and column improvements

Description:
Implement WIP limits and enhance column functionality.

Acceptance Criteria:

1. Add WIP limit display:
   - Show count and limit: "5/8"
   - Visual indicator when approaching limit (yellow)
   - Visual indicator when over limit (red)

2. Column header enhancements:
   - Sticky when scrolling
   - Collapse/expand toggle
   - Column actions menu

3. Add quick-create button:
   - At bottom of each column
   - Pre-selects status
   - Opens create modal

4. Improve drop zones:
   - Highlight valid drop targets during drag
   - Show ghost placeholder
   - Visual feedback on hover

5. Column styling:
   - Better borders
   - Background color differentiation
   - Smooth animations

References:

1. `apps/web/src/pages/kanban/KanbanColumnsView.tsx`
2. `apps/web/src/pages/kanban/KanbanBoard.tsx`

#### Task E073-015: Implement swimlanes

Description:
Add swimlane support for grouping work items.

Acceptance Criteria:

1. Create swimlane selector:
   - Group by: None, Priority, Assignee, Epic
   - Dropdown in board controls

2. Implement swimlane layout:
   - Horizontal dividers with labels
   - Each swimlane has its own columns
   - Or shared columns with grouped cards

3. Visual design:
   - Swimlane headers with counts
   - Collapsible swimlanes
   - Distinct background per swimlane (subtle)

4. Drag-and-drop:
   - Items can move between swimlanes
   - Updates assignee/priority/epic accordingly

5. Persist swimlane preference per project.

References:

1. `apps/web/src/pages/kanban/KanbanBoard.tsx`
2. `apps/web/src/pages/kanban/KanbanBoardControls.tsx`

#### Task E073-016: Add inline editing capabilities

Description:
Enable inline editing for quick card updates.

Acceptance Criteria:

1. Inline title editing:
   - Click to edit
   - Enter to save
   - Escape to cancel
   - Validation

2. Quick status change:
   - Right-click menu
   - Status dropdown on card

3. Quick assign:
   - Assignee avatar click
   - Opens assignee picker

4. Optimistic updates:
   - Immediate UI update
   - Rollback on error

References:

1. `apps/web/src/pages/kanban/KanbanWorkItemCard.tsx`
2. `apps/web/src/pages/kanban/WorkItemDetailSheet.tsx`

---

### WS5: Active Session Workspace Redesign

Objective: Improve active session workspace with focus modes and better status communication.

#### Task E073-017: Implement focus mode layouts

Description:
Create distinct layout modes for different activities.

Acceptance Criteria:

1. **Monitor Mode (Default):**
   ```
   ┌─────────────────┬──────────────────┐
   │                 │   Chat/Terminal  │
   │  Workflow Graph │   (focus area)   │
   │  (minimap)      ├──────────────────┤
   │                 │   Status/Controls│
   └─────────────────┴──────────────────┘
   ```

2. **Debug Mode:**
   ```
   ┌─────────────────┬──────────────────┐
   │                 │   Terminal       │
   │  File Tree +    ├──────────────────┤
   │  Diff Viewer    │   Logs           │
   │                 ├──────────────────┤
   │                 │   Variables      │
   └─────────────────┴──────────────────┘
   ```

3. Mode switcher:
   - Tab or toggle in header
   - Persist preference
   - Smooth transition

4. Resizable panels:
   - Drag to resize
   - Persist sizes
   - Reset to default option

References:

1. `apps/web/src/pages/active-session/ActiveSessionWorkspace.tsx`
2. `apps/web/src/pages/active-session/ActiveSessionWorkspacePanels.tsx`

#### Task E073-018: Add prominent status bar

Description:
Create a prominent status bar for run state communication.

Acceptance Criteria:

1. Status bar component:
   - Large status badge (Running | Paused | Failed | Completed)
   - Animated indicator for active runs
   - Progress percentage and ETA
   - Current step display: "Step 3 of 7"

2. Visual design:
   - Color-coded by status
   - Pulsing animation for running
   - Sticky positioning

3. Controls integration:
   - Pause/Resume/Abort buttons
   - Status-aware button states

4. Expandable details:
   - Click to see full run details
   - Timeline of steps

References:

1. `apps/web/src/pages/active-session/ActiveSessionWorkspace.tsx`
2. `apps/web/src/components/workflow/WorkflowStatusBadge.tsx`

#### Task E073-019: Improve question/answer cards

Description:
Enhance the question cards for better user interaction.

Acceptance Criteria:

1. Card-based layout:
   - Clear call-to-action
   - Visual hierarchy

2. Input types:
   - Radio buttons for single choice
   - Checkboxes for multiple choice
   - Text input for open-ended

3. Additional features:
   - "Ask for clarification" option
   - Save draft responses
   - Required field validation

4. Visual polish:
   - Smooth animations
   - Success feedback on submit

References:

1. `apps/web/src/components/workflow/QuestionCard.tsx`
2. `apps/web/src/pages/active-session/ActiveSessionWorkspaceContent.tsx`

#### Task E073-020: Enhance terminal and logs

Description:
Improve terminal panel with better formatting and features.

Acceptance Criteria:

1. Syntax highlighting:
   - JSON/YAML syntax highlighting
   - Log level color coding

2. Features:
   - Search/filter within logs
   - Collapsible sections
   - Download logs button
   - Auto-scroll toggle
   - Copy to clipboard

3. Performance:
   - Virtual scrolling for large logs
   - Debounced updates

4. Visual design:
   - Monospace font
   - Line numbers
   - Timestamp formatting

References:

1. `apps/web/src/components/workflow/ExecutionLogs.tsx`
2. `apps/web/src/pages/active-session/ActiveSessionWorkspaceContent.tsx`

---

### WS6: Forms, Micro-interactions, and Polish

Objective: Add polish through smart forms, notifications, and micro-interactions.

#### Task E073-021: Implement toast notification system

Description:
Add toast notifications for user feedback.

Acceptance Criteria:

1. Install toast library:
   ```bash
   npm install sonner
   ```

2. Configure Toaster component:
   - Position: top-right
   - Duration: 5s (with pause on hover)
   - Stacking behavior

3. Toast types:
   - Success (green)
   - Error (red)
   - Warning (yellow)
   - Info (blue)

4. Toast features:
   - Action buttons (Undo, View details)
   - Progress bar
   - Dismiss button
   - Swipe to dismiss

5. Integration points:
   - Form submissions
   - Status changes
   - Error messages
   - Background task completion

References:

1. `apps/web/src/components/layout/Layout.tsx`
2. `apps/web/src/hooks/` (create toast hook)

#### Task E073-022: Add form autosave and smart validation

Description:
Implement autosave and improved validation for forms.

Acceptance Criteria:

1. Autosave functionality:
   - Debounced save (2s delay)
   - "Last saved 2m ago" indicator
   - Recover draft on return
   - Clear on successful submit

2. Smart validation:
   - Inline field validation
   - Helpful error messages
   - Field-level help tooltips
   - Real-time validation (on blur)

3. Form enhancements:
   - Conditional fields
   - Section navigation for long forms
   - Dirty state tracking

4. Draft management:
   - Persist to localStorage
   - Clear on submit
   - Conflict detection

References:

1. `apps/web/src/components/ui/form.tsx`
2. `apps/web/src/pages/projects/ProjectCreate.tsx`

#### Task E073-023: Improve loading states

Description:
Create content-aware loading states.

Acceptance Criteria:

1. Content-aware skeletons:
   - Match final layout shape
   - Different skeletons for different content types
   - Progressive loading (header first)

2. Skeleton components:
   - CardSkeleton
   - TableSkeleton
   - FormSkeleton
   - DashboardSkeleton

3. Staggered animations:
   - List items animate in sequence
   - Subtle delay between items

4. Loading messages:
   - Context-aware ("Loading projects...")
   - Helpful for long loads

References:

1. `apps/web/src/components/ui/skeleton.tsx`
2. `apps/web/src/pages/Dashboard.tsx`
3. `apps/web/src/pages/projects/Projects.tsx`

#### Task E073-024: Add empty states

Description:
Create helpful empty states for all list views.

Acceptance Criteria:

1. Empty state component:
   - Illustration or icon
   - Contextual headline
   - Helpful description
   - Clear CTA button

2. Create empty states for:
   - No projects
   - No work items
   - No workflows
   - Empty kanban column
   - No notifications
   - No sessions

3. Examples:
   ```
   [Empty Board Illustration]
   
   No work items in this column
   
   Get started by creating your first work item.
   
   [Create Work Item]
   ```

4. Visual design:
   - Centered layout
   - Muted colors
   - Friendly illustrations (Lucide icons or custom)

References:

1. `apps/web/src/pages/projects/Projects.tsx`
2. `apps/web/src/pages/kanban/KanbanBoard.tsx`

#### Task E073-025: Add micro-interactions

Description:
Add subtle animations and interactions for polish.

Acceptance Criteria:

1. Hover effects:
   - Cards: subtle lift + shadow
   - Buttons: scale 1.02
   - Table rows: background color change
   - Links: underline animation

2. Focus states:
   - Clear focus rings
   - Smooth transitions

3. Page transitions:
   - Fade in on route change
   - Subtle slide for modals

4. Success states:
   - Checkmark animation
   - Confetti for major achievements

5. Performance:
   - Use CSS transitions (not JS animations)
   - Respect `prefers-reduced-motion`

References:

1. `apps/web/src/index.css`
2. `apps/web/tailwind.config.js`
3. `apps/web/src/components/ui/` (update components)

---

## 7. Cross-Cutting Acceptance Criteria

1. All new features maintain WCAG 2.1 AA accessibility standards.
2. Dark mode works correctly for all new components.
3. Responsive design works on tablet and desktop (mobile out of scope).
4. All existing tests continue to pass.
5. New features have appropriate test coverage.
6. Bundle size increase is minimal (<100KB gzipped).
7. Performance metrics (Lighthouse) maintain or improve scores.
8. No breaking changes to existing APIs or data structures.
9. All UI text is clear and follows writing guidelines.
10. Keyboard navigation works for all interactive elements.

---

## 8. Delivery Sequence (Recommended)

1. **WS1 first**: Establish visual foundation (colors, shadows, typography).
2. **WS6 second**: Add polish items that affect all pages (toasts, loading states, empty states).
3. **WS2 third**: Navigation improvements (command palette, breadcrumbs, sidebar).
4. **WS3 fourth**: Dashboard redesign (builds on WS1 and WS6).
5. **WS4 fifth**: Kanban improvements (builds on WS1 and WS6).
6. **WS5 last**: Active session workspace (most complex, builds on all previous work).

---

## 9. Risks and Mitigations

1. **Risk: Visual changes disrupt user muscle memory**
   - Mitigation: Gradual rollout with feature flags
   - Provide "classic" mode option during transition
   - User communication and documentation

2. **Risk: Performance degradation with new animations**
   - Mitigation: Use CSS transitions, avoid JS animations
   - Respect `prefers-reduced-motion`
   - Performance budget monitoring

3. **Risk: Accessibility regression**
   - Mitigation: Automated a11y testing in CI
   - Manual accessibility audit
   - Keyboard navigation testing

4. **Risk: Bundle size increase**
   - Mitigation: Code-split heavy features
   - Tree-shake unused dependencies
   - Lazy load charts and heavy components

5. **Risk: Dark mode color contrast issues**
   - Mitigation: Automated contrast checking
   - Manual review of all color combinations
   - Use established color scales (e.g., Tailwind's)

---

## 10. Dependencies

1. **EPIC-057**: Agent skill system (for skill-related UI).
2. **EPIC-060**: Workflow graph visualization (coordinate on shared components).
3. **EPIC-072**: Workflow launch (coordinate on shared launch dialogs).
4. Design system must remain stable (shadcn/ui upgrades coordinated).

---

## 11. Open Questions

1. Should we implement a "classic mode" toggle for users who prefer the old design?
2. Do we need custom illustrations for empty states, or are Lucide icons sufficient?
3. Should we add user preference persistence for layout modes and sidebar state?
4. Do we need analytics tracking for UI interactions (command palette usage, etc.)?
5. Should we conduct user testing before full rollout?

---

## 12. Definition of Done

EPIC-073 is done when all of the following are true:

1. Enhanced color palette with semantic tokens is implemented and documented.
2. Command palette (Cmd+K) works for navigation and search.
3. Breadcrumbs appear on all nested pages.
4. Dashboard displays stat cards with trends and activity feed.
5. Kanban cards show priority, assignee, progress, and metadata.
6. Active session workspace has focus modes and prominent status bar.
7. Toast notification system is operational.
8. Form autosave works on major forms.
9. All empty states are implemented with helpful CTAs.
10. All changes meet accessibility standards and work in dark mode.
11. No regressions in existing functionality.
12. Documentation is updated with new UI patterns.

---

## 13. Success Metrics

1. **User engagement**: Increased pages per session (target: +20%)
2. **Task completion**: Reduced time to create work item (target: -30%)
3. **Navigation efficiency**: Command palette usage >50% of active users
4. **User satisfaction**: Positive feedback on visual refresh (target: >80% positive)
5. **Accessibility**: Lighthouse a11y score >95
6. **Performance**: Lighthouse performance score >90
7. **Adoption**: 100% of users on new UI within 2 weeks of rollout

---

## 14. References

1. `docs/analysis/ANALYSIS-frontend-ui-ux.md` - Detailed analysis document
2. `apps/web/src/index.css` - Current theme variables
3. `apps/web/tailwind.config.js` - Tailwind configuration
4. `apps/web/src/App.tsx` - Route definitions
5. `apps/web/src/components/layout/` - Layout components
6. `apps/web/src/pages/` - Page components
7. `apps/web/src/components/ui/` - shadcn/ui components
8. `apps/web/src/hooks/` - Custom hooks

---

## 15. Appendix: Design System Tokens

### Color Palette

```css
/* Primary Scale */
--primary-50: 221.2 83.2% 97%;
--primary-100: 221.2 83.2% 93%;
--primary-200: 221.2 83.2% 85%;
--primary-300: 221.2 83.2% 75%;
--primary-400: 221.2 83.2% 65%;
--primary-500: 221.2 83.2% 53.3%; /* Main */
--primary-600: 221.2 83.2% 45%;
--primary-700: 221.2 83.2% 35%;
--primary-800: 221.2 83.2% 25%;
--primary-900: 221.2 83.2% 15%;

/* Semantic Colors */
--success: 142.1 76.2% 36.3%;
--success-foreground: 0 0% 100%;
--warning: 38 92% 50%;
--warning-foreground: 0 0% 0%;
--error: 0 84.2% 60.2%;
--error-foreground: 0 0% 100%;
--info: 199 89% 48%;
--info-foreground: 0 0% 100%;

/* Accent Colors */
--accent-purple: 262.1 83.3% 57.8%;
--accent-green: 142.1 76.2% 36.3%;
--accent-orange: 24.6 95% 53.1%;
```

### Shadow Scale

```css
--shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
--shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
--shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
--shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
--shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
```

### Spacing Scale

```
Page padding: p-6 lg:p-8
Section spacing: space-y-12 (48px)
Component spacing: space-y-6 (24px)
Card padding: 32px (p-8)
Tight spacing: space-y-4 (16px)
```
