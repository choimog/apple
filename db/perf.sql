-- ============================================================================
--  사이트 속도 개선 — 한 번만 실행하면 됩니다
-- ============================================================================
--
--  【이 파일을 왜 실행하나요?】
--  사이트가 너무 느렸습니다. 원인은 "데이터베이스가 할 일을 사이트가 대신
--  하고 있었기" 때문입니다.
--
--  예를 들어 '수집된 날짜 목록' 을 얻으려고 순위표를 1,000줄씩 40번 읽어
--  왔습니다. 하루에 11만 줄이 쌓이는 표에서 이러면 날짜 두어 개 알아내는 데
--  4만 줄을 읽습니다. 이 파일은 그 일을 데이터베이스가 한 번에 하도록
--  바꿉니다.
--
--  【어떻게 실행하나요?】
--  1. Supabase 대시보드(https://supabase.com/dashboard) 접속
--  2. 왼쪽 메뉴에서 [SQL Editor] 클릭
--  3. [New query] 클릭
--  4. 이 파일 전체를 복사해서 붙여넣고 [Run] 클릭
--  → 끝입니다. 사이트를 다시 배포할 필요도 없습니다.
--
--  ※ 여러 번 실행해도 안전합니다. 데이터는 하나도 안 바뀝니다.
--  ※ 실행하기 전에도 사이트는 정상 동작합니다 (느릴 뿐입니다).
--    사이트가 이 기능이 있는지 먼저 확인하고, 없으면 예전 방식으로 돕니다.
-- ============================================================================


-- ----------------------------------------------------------------------------
--  1. 인덱스 — "이 분야의 어제 기록" 을 빨리 찾기 위한 색인
-- ----------------------------------------------------------------------------
--  등락(▲▼)을 계산하려면 '이 분야의 바로 앞 수집일' 을 찾아야 합니다.
--  기존 색인은 날짜가 앞에 있어서 분야로 먼저 좁히지 못했습니다.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rankings_cat_date
    ON rankings(category_id, snapshot_date DESC);


-- ----------------------------------------------------------------------------
--  2. 수집된 날짜 목록
-- ----------------------------------------------------------------------------
--  【왜 이렇게 복잡하게 쓰나요?】
--  "날짜 종류만 알려줘"(SELECT DISTINCT)를 그냥 하면 표 전체를 훑습니다.
--  대신 "가장 큰 날짜" → "그보다 작은 것 중 가장 큰 날짜" → … 를 반복하면
--  색인만 타고 날짜 개수만큼만 봅니다. 11만 줄이든 1,100만 줄이든 똑같이
--  빠릅니다. (데이터베이스에서 흔히 쓰는 방법입니다)
--
--  SECURITY INVOKER = 부르는 사람의 권한으로 실행합니다.
--  즉 보안 잠금(RLS)을 우회하지 않습니다. 읽기 전용이라 안전합니다.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snapshot_dates(n int DEFAULT 60)
RETURNS TABLE (snapshot_date date)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    WITH RECURSIVE step AS (
        SELECT max(r.snapshot_date) AS d FROM rankings r
        UNION ALL
        SELECT (SELECT max(r.snapshot_date)
                  FROM rankings r
                 WHERE r.snapshot_date < step.d)
          FROM step
         WHERE step.d IS NOT NULL
    )
    SELECT step.d
      FROM step
     WHERE step.d IS NOT NULL
     ORDER BY step.d DESC
     LIMIT greatest(1, least(n, 400));
$$;


-- ----------------------------------------------------------------------------
--  3. 종합 베스트셀러 (3사 순위 평균)
-- ----------------------------------------------------------------------------
--  예전에는 사이트가 순위 6,000줄을 받아와서 직접 계산했습니다.
--  이제 데이터베이스가 계산해서 100줄만 보냅니다.
--
--  【계산 규칙 — 화면에 적어 둔 것과 똑같습니다】
--   · 각 서점의 p_depth 위까지만 봅니다
--   · 한 서점 안에서 여러 분야에 올라 있으면 '가장 높은 순위' 를 씁니다
--   · 올라 있는 서점들의 순위만 평균 냅니다 (없는 서점은 계산에서 뺌)
--   · 아직 같은 책으로 안 묶인 책(book_id 없음)은 제외합니다
--   · 판매지수는 서점별로 따로 담습니다 (서로 다른 지표라 평균 내지 않음)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.combined_best(
    p_date       date,
    p_period     text,
    p_unified    text,
    p_min_stores int DEFAULT 2,
    p_depth      int DEFAULT 300,
    p_limit      int DEFAULT 100
)
RETURNS TABLE (
    book_id     bigint,
    title       text,
    author      text,
    publisher   text,
    cover_url   text,
    store_count int,
    avg_rank    numeric,
    ranks       jsonb,
    sales       jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    WITH cats AS (
        SELECT c.id, c.store_id
          FROM categories c
         WHERE c.enabled
           AND c.unified_code = p_unified
           AND c.kind <> 'offline'      -- 매장별은 온라인 순위와 성격이 달라 제외
           AND (CASE WHEN c.kind = 'weekly' THEN 'weekly' ELSE 'daily' END) = p_period
    ),
    per_store AS (
        -- 한 서점 안에서 여러 분야에 올라 있으면 가장 높은(작은) 순위를 씁니다
        SELECT sb.book_id,
               cats.store_id,
               min(r.rank) AS best_rank,
               (array_agg(r.sales_point ORDER BY r.rank))[1] AS sales_point
          FROM rankings r
          JOIN cats            ON cats.id = r.category_id
          JOIN store_books sb  ON sb.id   = r.store_book_id
         WHERE r.snapshot_date = p_date
           AND r.rank <= p_depth
           AND sb.book_id IS NOT NULL
         GROUP BY sb.book_id, cats.store_id
    ),
    agg AS (
        SELECT ps.book_id,
               count(*)::int                     AS store_count,
               round(avg(ps.best_rank), 1)       AS avg_rank,
               jsonb_object_agg(ps.store_id::text, ps.best_rank) AS ranks,
               coalesce(
                   jsonb_object_agg(ps.store_id::text, ps.sales_point)
                       FILTER (WHERE ps.sales_point IS NOT NULL),
                   '{}'::jsonb
               )                                 AS sales
          FROM per_store ps
         GROUP BY ps.book_id
    )
    SELECT a.book_id,
           b.title,
           b.author,
           b.publisher,
           b.cover_url,
           a.store_count,
           a.avg_rank,
           a.ranks,
           a.sales
      FROM agg a
      JOIN books b ON b.id = a.book_id
     WHERE a.store_count >= p_min_stores
     ORDER BY a.avg_rank ASC, a.store_count DESC
     LIMIT greatest(1, least(p_limit, 500));
$$;


-- ----------------------------------------------------------------------------
--  4. 사이트(공개용 열쇠)가 이 두 기능을 쓸 수 있게 허용
-- ----------------------------------------------------------------------------
--  둘 다 읽기 전용이고 SECURITY INVOKER 라 보안 잠금을 우회하지 않습니다.
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.snapshot_dates(int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.combined_best(date, text, text, int, int, int)
    TO anon, authenticated;


-- ============================================================================
--  확인: 아래를 실행하면 결과가 바로 나와야 합니다 (몇 십 밀리초)
-- ============================================================================
--  SELECT * FROM snapshot_dates(14);
--  SELECT * FROM combined_best((SELECT max(snapshot_date) FROM rankings),
--                              'daily', 'all', 2, 300, 20);
-- ============================================================================
