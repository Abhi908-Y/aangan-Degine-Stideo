-- 14 placeholder designers. Replace names and add real Telegram chat ids.
-- Only inserted into an empty table, so re-running db:setup doesn't duplicate them.
INSERT INTO designers (name)
SELECT n FROM (VALUES
 ('Designer 01'),('Designer 02'),('Designer 03'),('Designer 04'),('Designer 05'),
 ('Designer 06'),('Designer 07'),('Designer 08'),('Designer 09'),('Designer 10'),
 ('Designer 11'),('Designer 12'),('Designer 13'),('Designer 14')
) AS v(n)
WHERE NOT EXISTS (SELECT 1 FROM designers);

-- Mock calendar: for the next 14 days, Mon–Sat, each designer gets three 30-min
-- consultation slots (11:00, 15:00, 17:30 IST). Replace with Cal.com later.
INSERT INTO designer_slots (designer_id, starts_at)
SELECT d.id,
       (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + (g.day || ' days')::interval + t.t)
         AT TIME ZONE 'Asia/Kolkata'
FROM designers d
CROSS JOIN generate_series(1, 14) AS g(day)
CROSS JOIN (VALUES (interval '11 hours'), (interval '15 hours'), (interval '17 hours 30 minutes')) AS t(t)
WHERE extract(isodow FROM (now() AT TIME ZONE 'Asia/Kolkata') + (g.day || ' days')::interval) < 7
ON CONFLICT DO NOTHING;
