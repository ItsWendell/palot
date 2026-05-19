---
title: Next.js App Architecture
description: Patterns and conventions for building Next.js 14+ applications with the App Router.
source: palot-knowledge
tags: nextjs, react, app-router, typescript, fullstack
agents: fullstack-developer, backend-developer, architect-reviewer
updated: 2026-05-16
---

## Project Structure

```
app/
  (marketing)/          # route group — no layout impact, for org only
    page.tsx
  (app)/                # auth-required group
    layout.tsx          # shared layout with auth check
    dashboard/
      page.tsx
      loading.tsx       # suspense boundary
      error.tsx         # error boundary
  api/
    [resource]/
      route.ts          # GET, POST — one file per resource
  layout.tsx            # root layout
  globals.css
components/             # shared — NOT route-specific
  ui/                   # primitives (Button, Input, etc.)
  [feature]/            # feature clusters
lib/
  [resource]/
    actions.ts          # Server Actions for this resource
    queries.ts          # DB/API reads
    schema.ts           # Zod schemas
    types.ts            # TypeScript types
```

## Data Fetching Patterns

### Server Components (default — prefer these)
```tsx
// app/dashboard/page.tsx
export default async function DashboardPage() {
  const data = await fetchDashboardData()  // runs on server
  return <Dashboard data={data} />
}
```

### Parallel Data Fetching
```tsx
// Avoid waterfall — always fetch in parallel
const [user, posts, settings] = await Promise.all([
  fetchUser(id),
  fetchPosts(userId),
  fetchSettings(userId),
])
```

### Streaming with Suspense
```tsx
export default function Page() {
  return (
    <>
      <StaticHeader />
      <Suspense fallback={<PostsSkeleton />}>
        <Posts />  {/* async server component */}
      </Suspense>
    </>
  )
}
```

## Server Actions

```ts
// lib/posts/actions.ts
"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

const CreatePostSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1),
})

export async function createPost(formData: FormData) {
  const parsed = CreatePostSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
  })
  if (!parsed.success) return { error: parsed.error.flatten() }

  await db.post.create({ data: parsed.data })
  revalidatePath("/posts")
}
```

## Route Handlers

```ts
// app/api/posts/route.ts
import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const page = Number(searchParams.get("page") ?? "1")
  const posts = await fetchPosts({ page })
  return NextResponse.json(posts)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const post = await createPost(body)
  return NextResponse.json(post, { status: 201 })
}
```

## Middleware

```ts
// middleware.ts
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  const token = request.cookies.get("auth-token")
  if (!token && request.nextUrl.pathname.startsWith("/app")) {
    return NextResponse.redirect(new URL("/login", request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ["/app/:path*", "/api/:path*"],
}
```

## Performance Checklist

- [ ] Static data: use `export const revalidate = 3600` on route segments
- [ ] Images: always `next/image` with explicit `width`/`height` or `fill`
- [ ] Fonts: `next/font` with `display: swap`
- [ ] Dynamic imports for heavy client components: `dynamic(() => import("..."))`
- [ ] Bundle analysis: `ANALYZE=true npm run build`
- [ ] No `"use client"` at layout level — push it down to interactive leaves

## Error Handling

```tsx
// app/dashboard/error.tsx
"use client"
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <h2>Something went wrong</h2>
      <button onClick={reset}>Try again</button>
    </div>
  )
}
```

## Common Anti-Patterns to Avoid

- **Don't** call Server Actions in `useEffect` — use them in form `action` props or event handlers
- **Don't** use `getServerSideProps` in App Router — use async server components
- **Don't** import server-only code in client components — add `import "server-only"` guard
- **Don't** put every component in a route file — colocate only page/layout/error/loading
- **Don't** use `router.push` for form submissions — use Server Actions with `redirect()`
