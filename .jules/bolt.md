## 2026-04-16 - Store Architecture Hardening
**Learning:** Migrating from ad-hoc JSON carts to explicit structured tables like `store_orders` and `custom_quote_requests` simplifies Worker webhook handling.
**Action:** Ensure that new commerce features build against the canonical `store_*` namespace directly to preserve idempotency and referential integrity.

## 2025-05-14 - [Performance] Optimized Ops Batch Product Insertion
**Learning:** Sequential database inserts in a loop (N+1 query pattern) in Cloudflare Workers significantly increase latency due to multiple round-trips to the database.
**Action:** Use Supabase's native batch insert capability () to perform multiple insertions in a single database call, reducing I/O overhead and improving response times.

## 2025-05-14 - [Performance] Optimized Ops Batch Product Insertion
**Learning:** Sequential database inserts in a loop (N+1 query pattern) in Cloudflare Workers significantly increase latency due to multiple round-trips to the database.
**Action:** Use Supabase's native batch insert capability (`insert([...items])`) to perform multiple insertions in a single database call, reducing I/O overhead and improving response times.

## 2025-05-14 - [Performance] Optimized Store Checkout Loop
**Learning:** During array `.reduce()` operations in React components (like cart or checkout totals), using `.find()` inside the reducer creates an unexpected $O(N^2)$ algorithmic bottleneck, particularly when de-duplicating items by properties like `name` or `id`.
**Action:** Always replace nested `.find()` operations inside a `.reduce()` loop with an intermediate accumulator of type `Record<string, T>` to enable $O(1)$ property-based dictionary lookups.
## 2026-05-06 - [React Rendering Loop Optimization]
**Learning:** Found `reduce` calculations running inline within a React component's rendering flow, which triggers an O(N) operation on every single re-render. Since `useMemo` caches derived data and skips execution unless its dependencies change, it is optimal for replacing un-memoized loops.
**Action:** Extract large or repeated O(N) functional loops (like `.map` or `.reduce`) from directly inside returned TSX elements into  hooks above the render, especially when the resulting calculations don't change between re-renders.
## 2026-05-06 - [React Rendering Loop Optimization]
**Learning:** Found reduce calculations running inline within a React component's rendering flow, which triggers an O(N) operation on every single re-render. Since useMemo caches derived data and skips execution unless its dependencies change, it is optimal for replacing un-memoized loops.
**Action:** Extract large or repeated O(N) functional loops (like .map or .reduce) from directly inside returned TSX elements into useMemo hooks above the render, especially when the resulting calculations don't change between re-renders.
## 2026-05-18 - [Performance] Optimized Media Library Tab Component
**Learning:** In React components like `MediaLibraryTab.tsx`, calling array methods such as `.find()` on every single render cycle creates unnecessary (N)$ overhead, especially when parsing state values for derived props.
**Action:** Always wrap derived property lookups that involve array iteration with `useMemo` hooks and explicitly define the dependency arrays to ensure the lookup logic executes *only* when the parent collection or the target identifier changes.
## 2026-05-21 - [React Rendering & Memory Optimization]
**Learning:** Avoid using array spread syntax `[...a, ...b]` directly inside React render or hook dependencies when searching for elements via `.find()`, as it creates unnecessary O(N) array allocations on every render or dependency change.
**Action:** Replace the spread and combined `.find()` with sequentially short-circuited searches (e.g., `a.find(...) ?? b.find(...)`) to save memory and CPU cycles.
## 2026-06-27 - [Performance] Optimized Store Checkout Loop
**Learning:** During array `.reduce()` operations in React components (like cart or checkout totals), running an un-memoized reduce inline causes it to execute on every render, which is an (N)$ operation. Even when replacing nested  with (1)$ lookups, the outer loop still runs.
**Action:** Always wrap large or repeated (N)$ array reduction calculations (like ) in a `useMemo` block if they occur inside the render flow of a functional component to avoid recalculating unnecessarily.
## 2024-03-24 - [Performance] Optimized Subtotal Calculation in Checkout Loop
**Learning:** Running an un-memoized `reduce` inline in a React component causes the O(N) array reduction to execute on every single render cycle, wasting CPU cycles and potentially causing jank.
**Action:** Always wrap O(N) array reduction calculations (like `bagItems.reduce`) in a `useMemo` block when they occur inside the render flow of a functional component, providing the source arrays as dependencies to avoid recalculating unnecessarily.
