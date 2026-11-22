-- =============================================================================
-- Golf OS — 005_demo_white_tee_only.sql
-- Demo decision (user, 2026-11-22): only the White tee has per-hole yardages,
-- so Blue and Red are hidden from golfers. Re-activate a tee after loading its
-- hole_yardages rows; course_integrity_issues reports missing yardages for active tees.
-- =============================================================================
update public.course_tees t
   set is_active = false
  from public.courses c
 where c.id = t.course_id
   and c.slug = 'asc-centre-bengaluru'
   and t.name in ('Blue', 'Red');
