-- ============================================================================
--  진단 — 데이터베이스가 어떤 상태인지 확인합니다
-- ============================================================================
--
--  【언제 쓰나요?】
--  perf.sql 을 실행했는데 오류가 났을 때, 무엇이 없어서 그런지 알아내려고
--  씁니다. 읽기만 하므로 **데이터는 하나도 바뀌지 않습니다.**
--
--  【어떻게 쓰나요?】
--  Supabase → SQL Editor → New query → 이 파일 전체 붙여넣기 → Run
--  → 나온 표를 그대로 저에게 보여주세요.
-- ============================================================================

SELECT
    '① 표가 있는지' AS 확인항목,
    string_agg(table_name, ', ' ORDER BY table_name) AS 결과
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('stores','categories','books','store_books',
                     'rankings','book_meta','crawl_logs','book_matches')

UNION ALL

SELECT
    '② rankings 의 칸 목록  ← 여기에 category_id 가 있어야 합니다',
    coalesce(string_agg(column_name, ', ' ORDER BY ordinal_position), '‼️ rankings 표가 없습니다')
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'rankings'

UNION ALL

SELECT
    '③ categories 의 칸 목록  ← unified_code 가 있어야 합니다',
    coalesce(string_agg(column_name, ', ' ORDER BY ordinal_position), '‼️ categories 표가 없습니다')
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'categories'

UNION ALL

SELECT
    '④ crawl_logs 의 칸 목록  ← started_at, finished_at 이 있어야 합니다',
    coalesce(string_agg(column_name, ', ' ORDER BY ordinal_position), '‼️ crawl_logs 표가 없습니다')
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'crawl_logs'

UNION ALL

SELECT
    '⑤ books 의 칸 목록  ← author, publisher 가 있어야 합니다',
    coalesce(string_agg(column_name, ', ' ORDER BY ordinal_position), '‼️ books 표가 없습니다')
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'books'

UNION ALL

SELECT
    '⑥ 이미 만들어진 계산 기능',
    coalesce(string_agg(p.proname, ', ' ORDER BY p.proname), '(아직 없음)')
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('snapshot_dates','combined_rows','combined_best',
                    'publisher_ranking','author_ranking','books_of',
                    'category_share','search_books_merged','crawl_summary')

UNION ALL

SELECT
    '⑦ pg_trgm(검색용 확장) 켜져 있는지',
    CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm')
         THEN '✅ 켜져 있음' ELSE '‼️ 꺼져 있음 — schema.sql 을 다시 실행하세요' END

UNION ALL

SELECT
    '⑧ 쌓인 자료',
    (SELECT count(*)::text FROM categories) || '개 분야 · ' ||
    (SELECT count(*)::text FROM rankings)   || '건 순위 · ' ||
    (SELECT count(*)::text FROM books)      || '종 도서';
