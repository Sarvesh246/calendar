-- When an item's status last changed, tracked separately from `updated_at`.
-- Safe to re-run.
--
-- Marking something done is the edit users least expect to lose, and it kept
-- losing. A calendar feed re-import rewrites an item's description or category
-- and moves `updated_at`, so the importing device's whole row — including its
-- stale "todo" — won the next merge against another device where you'd just
-- ticked the item off. Status now carries its own timestamp and is merged on
-- its own, so a feed refresh can't roll back progress made elsewhere.
alter table public.items add column if not exists status_at timestamptz;

notify pgrst, 'reload schema';
