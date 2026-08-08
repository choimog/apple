-- ============================================================================
--  진단 — 이 데이터베이스가 어떤 상태인지 확인합니다
-- ============================================================================
--
--  【언제 쓰나요?】
--  perf.sql 이나 다른 SQL 을 실행했는데 오류가 났을 때, 무엇이 없어서
--  그런지 알아내려고 씁니다.
--
--  ✅ 읽기만 합니다. 데이터는 하나도 바뀌지 않습니다.
--  ✅ 표가 하나도 없는 빈 데이터베이스에서도 오류 없이 돕니다.
--     (2026-08-08: 처음 만든 판은 표가 없으면 그냥 죽어버려서, 정작
--      필요한 상황에서 쓸 수 없었습니다. 그래서 다시 만들었습니다)
--
--  【어떻게 쓰나요?】
--  Supabase → SQL Editor → New query → 이 파일 전체 붙여넣기 → Run
--  → 나온 표를 그대로 보여주세요.
-- ============================================================================

WITH t AS (
    -- to_regclass 는 표가 없으면 오류 대신 NULL 을 돌려줍니다.
    -- 그래서 빈 데이터베이스에서도 안전합니다.
    SELECT to_regclass('public.stores')      AS stores,
           to_regclass('public.categories')  AS categories,
           to_regclass('public.books')       AS books,
           to_regclass('public.store_books') AS store_books,
           to_regclass('public.rankings')    AS rankings,
           to_regclass('public.crawl_logs')  AS crawl_logs
),
cols AS (
    SELECT table_name, string_agg(column_name, ', ' ORDER BY ordinal_position) AS list
      FROM information_schema.columns
     WHERE table_schema = 'public'
     GROUP BY table_name
)
SELECT * FROM (

    SELECT 1 AS n,
           '① 이 데이터베이스에 표가 있나' AS 확인항목,
           CASE WHEN (SELECT categories FROM t) IS NULL
                THEN '‼️ 없습니다 — db/schema.sql 을 아직 실행하지 않았거나, 다른 프로젝트를 보고 계십니다'
                ELSE '✅ 있습니다' END AS 결과

    UNION ALL SELECT 2,
           '② 있는 표 목록',
           coalesce((SELECT string_agg(table_name, ', ' ORDER BY table_name)
                       FROM information_schema.tables
                      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'),
                    '(표가 하나도 없습니다)')

    UNION ALL SELECT 3,
           '③ rankings 의 칸  ← category_id 가 있어야 합니다',
           coalesce((SELECT list FROM cols WHERE table_name = 'rankings'),
                    '‼️ rankings 표가 없습니다')

    UNION ALL SELECT 4,
           '④ categories 의 칸  ← unified_code 가 있어야 합니다',
           coalesce((SELECT list FROM cols WHERE table_name = 'categories'),
                    '‼️ categories 표가 없습니다')

    UNION ALL SELECT 5,
           '⑤ crawl_logs 의 칸  ← started_at, finished_at 이 있어야 합니다',
           coalesce((SELECT list FROM cols WHERE table_name = 'crawl_logs'),
                    '‼️ crawl_logs 표가 없습니다')

    UNION ALL SELECT 6,
           '⑥ books 의 칸  ← author, publisher 가 있어야 합니다',
           coalesce((SELECT list FROM cols WHERE table_name = 'books'),
                    '‼️ books 표가 없습니다')

    UNION ALL SELECT 7,
           '⑦ 이미 만들어진 계산 기능 (perf.sql)',
           coalesce((SELECT string_agg(p.proname, ', ' ORDER BY p.proname)
                       FROM pg_proc p
                      WHERE p.pronamespace = 'public'::regnamespace
                        AND p.proname IN ('snapshot_dates','category_dates','combined_rows',
                                          'combined_best','publisher_ranking','author_ranking',
                                          'books_of','category_share','search_books_merged',
                                          'crawl_summary','publisher_conflicts')),
                    '(아직 없음)')

    UNION ALL SELECT 8,
           '⑧ pg_trgm (검색용 확장)',
           CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm')
                THEN '✅ 켜져 있음' ELSE '‼️ 꺼져 있음' END

    UNION ALL SELECT 9,
           '⑨ 쌓인 자료',
           -- ⚠️ 여기서 'SELECT count(*) FROM categories' 를 그대로 쓰면 안 됩니다.
           --    표가 없을 때 CASE 로 감싸도 소용이 없습니다. PostgreSQL 은
           --    실행 전에 문장 전체를 해석하면서 없는 표를 발견하고 멈춥니다.
           --    (2026-08-08: 이것 때문에 진단 파일이 빈 DB 에서 죽었습니다)
           --    query_to_xml 은 조회문을 '글자' 로 받기 때문에, 표가 있을 때만
           --    실제로 실행됩니다.
           CASE WHEN (SELECT rankings FROM t) IS NULL THEN '(표가 없어 셀 수 없습니다)'
                ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM public.categories', false, true, '')))[1]::text || '개 분야 · ' ||
                     (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM public.rankings',   false, true, '')))[1]::text   || '건 순위 · ' ||
                     (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM public.books',      false, true, '')))[1]::text      || '종 도서'
           END

    UNION ALL SELECT 10,
           '⑩ 지금 보고 있는 데이터베이스',
           current_database() || ' / 접속 계정 ' || current_user

) x ORDER BY n;
