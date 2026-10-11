# Sentra web application

Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui.

## Run it

```bash
cp .env.example .env.local
npm ci
npm run dev
```

Open http://localhost:3000. The API must be running (`docker compose up -d` in the repository root).

| What | Command |
|---|---|
| Development server | `npm run dev` |
| Check code style | `npm run lint` |
| Check types | `npm run typecheck` |
| Production build | `npm run build` |

## Layout

```
src/
├── app/
│   ├── layout.tsx               fonts, theme, tooltips, toasts
│   └── (app)/                   pages inside the app shell (sidebar + top bar)
│       ├── layout.tsx
│       └── [...section]/        placeholder for pages that are not built yet
├── components/
│   ├── ui/                      shadcn/ui components (button, card, sidebar, …)
│   ├── layout/                  app sidebar, top bar, page header, empty state
│   └── sentra/                  Sentra components (severity badge, …)
├── config/navigation.ts         sidebar groups and items
└── lib/
    ├── api.ts                   apiFetch() and ApiError
    └── session.ts               logged-in user (placeholder until login exists)
```

## Adding a page

Create a folder for the route inside `src/app/(app)/`, for example
`src/app/(app)/targets/page.tsx`. It automatically replaces the placeholder and appears
inside the app shell. Start the page with `<PageHeader … />`.

## Design rules

The colours, fonts and spacing come from the Sentra design foundation and are defined
as CSS variables in `src/app/globals.css` (light and dark theme). Use the Tailwind
classes based on them (`bg-card`, `text-muted-foreground`, `border`, `bg-primary`, …)
instead of hex colours. Severity is always shown with `<SeverityBadge />`
(shape + colour + label).
