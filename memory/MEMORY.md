# Reply Flow Project Memory

## Architecture
- **Stack**: React + TypeScript + Vite, Tailwind CSS, Radix UI, react-router-dom v6
- **API**: Axios client at `client/src/lib/api.ts`
- **Auth**: Supabase auth, SessionContext at `client/src/contexts/SessionContext.tsx`
- **Routing**: Protected routes wrapped in ProtectedRoute + AppLayout in `client/src/App.tsx`

## Key Patterns
- UI: Radix UI primitives in `client/src/components/ui/`
- Toast notifications: `sonner` — `toast.success()` / `toast.error()`
- Permissions: `useSession().hasPermission(resource, action)` or `PermissionGate` component
- Subscription data: `useSubscription()` hook — fetches from `/billing/subscription`

## Plan/Subscription Gating System
Added in March 2026. When no active subscription exists, action buttons show a modal instead of executing.

### New files:
- `client/src/contexts/PlanContext.tsx` — `PlanProvider`, `usePlan()`, renders NoPlan dialog
- `client/src/components/auth/PlanGate.tsx` — wrapper component with click interceptor overlay

### How it works:
- `PlanProvider` fetches subscription on mount, exposes `hasActivePlan`, `openNoPlanModal`
- `PlanGate` wraps buttons: renders an invisible absolute overlay when no plan, intercepting clicks
- `usePlan()` hook can also be used directly for keyboard/form submit interception
- Active plan = `subscription.status === 'active' || 'trialing'`
- Modal navigates to `/settings?tab=billing` (View Plans button)

### App.tsx: PlanProvider wraps AppLayout inside protected routes
```tsx
<Route element={<PlanProvider><AppLayout /></PlanProvider>}>
```

### Files updated with PlanGate:
- `AIAgentsPage` — Create Agent buttons
- `KnowledgeBasePage` — Create/Edit/Delete KB, Create entry button
- `AgentDetailPage` — Edit name, Save name, Delete Agent
- `WhatsAppConnection` — Add Channel button
- `TeamPage` — Invite, Remove member, Copy link, Cancel invitation
- `ContactList` — Add contact (+) button
- `ContactDetail` — Edit and Delete buttons
- `ContactForm` — Form submit intercepted via `usePlan()` in handleSubmit
- `MessageInput` — Send button, Schedule button; Enter key intercepted via `usePlan()`
- `BulkActionBar` — All bulk actions intercepted via `usePlan()` in executeBulk
- `CompanySettingsPage` — Save Changes, Delete company trigger
- `RolePermissionsPage` — Save Changes, Reset to Defaults
- `AIAgentSections` — Save (response flow) button
- `ChannelDetailView` — Reconnect, Disconnect, Refresh QR, Delete channel, AI toggle

## Pages/Areas NOT gated (intentionally):
- BillingTab / BillingPage — this IS the plan selection page
- Navigation buttons (back arrows, tab switches)
- Cancel/Discard buttons
- ProfileSettingsPage — personal profile settings
