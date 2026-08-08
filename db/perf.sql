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
--  0. 먼저 확인 — 필요한 표와 칸이 다 있는지
-- ----------------------------------------------------------------------------
--  【왜 이걸 먼저 하나요? — 2026-08-08】
--  필요한 칸이 없으면 아래에서 'column "..." does not exist' 라는 짧은 오류만
--  나옵니다. 그 메시지만 봐서는 무엇을 어떻게 고쳐야 할지 알 수 없습니다.
--  그래서 먼저 확인하고, 없으면 무엇이 없는지 한국어로 알려드립니다.
-- ----------------------------------------------------------------------------
DO $guard$
DECLARE
    missing text := '';
    need    text[][] := ARRAY[
        ['rankings',   'category_id'],
        ['rankings',   'snapshot_date'],
        ['rankings',   'store_book_id'],
        ['rankings',   'rank'],
        ['categories', 'unified_code'],
        ['categories', 'kind'],
        ['categories', 'enabled'],
        ['store_books','book_id'],
        ['books',      'author'],
        ['books',      'publisher'],
        ['crawl_logs', 'started_at'],
        ['crawl_logs', 'finished_at']
    ];
    i int;
BEGIN
    FOR i IN 1 .. array_length(need, 1) LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name  = need[i][1]
               AND column_name = need[i][2]
        ) THEN
            missing := missing || format('  · %s 표의 %s 칸%s', need[i][1], need[i][2], chr(10));
        END IF;
    END LOOP;

    IF missing <> '' THEN
        RAISE EXCEPTION E'이 파일을 실행하기 전에 db/schema.sql 을 먼저 실행해야 합니다.\n\n없는 것:\n%\n하는 법: Supabase → SQL Editor → New query 에 저장소의 db/schema.sql 전체를 붙여넣고 Run → 그다음 이 파일(db/perf.sql)을 실행하세요.\n\n※ db/check.sql 을 실행하면 지금 상태를 자세히 볼 수 있습니다.', missing;
    END IF;
END
$guard$;


-- ----------------------------------------------------------------------------
--  1. 인덱스 — "이 분야의 어제 기록" 을 빨리 찾기 위한 색인
-- ----------------------------------------------------------------------------
--  등락(▲▼)을 계산하려면 '이 분야의 바로 앞 수집일' 을 찾아야 합니다.
--  기존 색인은 날짜가 앞에 있어서 분야로 먼저 좁히지 못했습니다.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rankings_cat_date
    ON rankings(category_id, snapshot_date DESC);

-- 저자 이름으로 검색할 때 쓰는 색인.
-- 제목·출판사에는 있었는데 저자에만 없어서, 저자 검색이 표 전체를 훑었습니다.
CREATE INDEX IF NOT EXISTS idx_books_author_trgm
    ON books USING gin (author gin_trgm_ops);


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
--  2-2. 한 분야에 자료가 있는 날짜만
-- ----------------------------------------------------------------------------
--  【왜 따로 필요한가요? — 2026-08-08 대표님 지적】
--  "알라딘·일간·전체·8/8 은 자료가 없다는데 8월 7일은 있거든?"
--
--  위 snapshot_dates 는 세 서점을 통째로 합친 날짜입니다. 교보가 저장하면
--  그 날짜가 목록에 뜨고, 알라딘의 그 분야에 없어도 고를 수 있었습니다.
--  서점별 화면은 '고른 분야에 실제로 있는 날짜' 만 보여줘야 합니다.
--
--  순위표를 훑지 않고 (category_id, snapshot_date) 색인만 건너뛰며 읽습니다.
--  자료가 몇 년치 쌓여도 날짜 개수만큼만 봅니다.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.category_dates(
    p_category_id int,
    n int DEFAULT 400
)
RETURNS TABLE (snapshot_date date)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    WITH RECURSIVE step AS (
        SELECT max(r.snapshot_date) AS d
          FROM rankings r
         WHERE r.category_id = p_category_id
        UNION ALL
        SELECT (SELECT max(r.snapshot_date)
                  FROM rankings r
                 WHERE r.category_id = p_category_id
                   AND r.snapshot_date < step.d)
          FROM step
         WHERE step.d IS NOT NULL
    )
    SELECT step.d
      FROM step
     WHERE step.d IS NOT NULL
     ORDER BY step.d DESC
     LIMIT greatest(1, least(n, 1000));
$$;


-- ----------------------------------------------------------------------------
--  3. 【공통】 그날의 '책별 3사 순위' — 아래 기능들이 전부 이걸 씁니다
-- ----------------------------------------------------------------------------
--  종합 순위·출판사 순위·저자 순위·분야 점유율이 모두 같은 계산을 씁니다.
--  한 군데에만 적어 두면 규칙이 어긋날 일이 없습니다.
--
--  【계산 규칙 — 화면에 적어 둔 것과 똑같습니다】
--   · 각 서점의 p_depth 위까지만 봅니다
--   · 한 서점 안에서 여러 분야에 올라 있으면 '가장 높은 순위' 를 씁니다
--   · 올라 있는 서점들의 순위만 평균 냅니다 (없는 서점은 계산에서 뺌)
--   · 아직 같은 책으로 안 묶인 책(book_id 없음)은 제외합니다
--   · 판매지수는 서점별로 따로 담습니다 (서로 다른 지표라 평균 내지 않음)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.combined_rows(
    p_date    date,
    p_period  text,
    p_unified text,
    p_depth   int DEFAULT 300
)
RETURNS TABLE (
    book_id     bigint,
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
    )
    SELECT ps.book_id,
           count(*)::int               AS store_count,
           round(avg(ps.best_rank), 1) AS avg_rank,
           jsonb_object_agg(ps.store_id::text, ps.best_rank) AS ranks,
           coalesce(
               jsonb_object_agg(ps.store_id::text, ps.sales_point)
                   FILTER (WHERE ps.sales_point IS NOT NULL),
               '{}'::jsonb
           ) AS sales
      FROM per_store ps
     GROUP BY ps.book_id;
$$;


-- ----------------------------------------------------------------------------
--  4. 종합 베스트셀러 (3사 순위 평균)
-- ----------------------------------------------------------------------------
--  예전에는 사이트가 순위 6,000줄을 받아와서 직접 계산했습니다.
--  이제 데이터베이스가 계산해서 100줄만 보냅니다.
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
    SELECT r.book_id, b.title, b.author, b.publisher, b.cover_url,
           r.store_count, r.avg_rank, r.ranks, r.sales
      FROM public.combined_rows(p_date, p_period, p_unified, p_depth) r
      JOIN books b ON b.id = r.book_id
     WHERE r.store_count >= p_min_stores
     ORDER BY r.avg_rank ASC, r.store_count DESC
     LIMIT greatest(1, least(p_limit, 500));
$$;


-- ----------------------------------------------------------------------------
--  5. 출판사별 순위
-- ----------------------------------------------------------------------------
--  【점수는 어떻게 매기나요? — 화면에도 그대로 적어 둡니다】
--    한 권이 평균 3위면  (300 + 1) - 3   = 298점
--    한 권이 평균 250위면 (300 + 1) - 250 =  51점
--  즉 "상위권에 몇 권을 올렸는가" 를 한 숫자로 나타낸 값입니다.
--  1위 한 권과 200위 열 권 중 어느 쪽이 센지를 비교할 수 있게 해 줍니다.
--
--  ※ 출판사 표기는 서점마다 다릅니다((주)문학동네 / 문학동네).
--    '(주)·주식회사·㈜' 만 떼고 묶습니다. 그 이상은 임의로 합치지 않습니다.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publisher_ranking(
    p_date       date,
    p_period     text,
    p_unified    text DEFAULT 'all',
    p_depth      int  DEFAULT 300,
    p_min_stores int  DEFAULT 1,
    p_limit      int  DEFAULT 50
)
RETURNS TABLE (
    name       text,
    books      int,
    best_rank  numeric,
    score      numeric,
    top_titles text[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    WITH rows AS (
        SELECT * FROM public.combined_rows(p_date, p_period, p_unified, p_depth)
    ),
    named AS (
        SELECT btrim(regexp_replace(b.publisher, '\(주\)|주식회사|㈜', '', 'g')) AS nm,
               b.title, r.avg_rank, r.book_id, r.store_count
          FROM rows r
          JOIN books b ON b.id = r.book_id
         WHERE b.publisher IS NOT NULL
           AND btrim(b.publisher) <> ''
           AND r.store_count >= p_min_stores
    )
    SELECT nm,
           count(DISTINCT book_id)::int,
           min(avg_rank),
           round(sum(greatest(0, (p_depth + 1) - avg_rank))),
           (array_agg(title ORDER BY avg_rank))[1:3]
      FROM named
     WHERE nm <> ''
     GROUP BY nm
     ORDER BY 4 DESC, 2 DESC
     LIMIT greatest(1, least(p_limit, 300));
$$;


-- ----------------------------------------------------------------------------
--  6. 저자별 순위 — 규칙은 출판사와 같습니다
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.author_ranking(
    p_date       date,
    p_period     text,
    p_unified    text DEFAULT 'all',
    p_depth      int  DEFAULT 300,
    p_min_stores int  DEFAULT 1,
    p_limit      int  DEFAULT 50
)
RETURNS TABLE (
    name       text,
    books      int,
    best_rank  numeric,
    score      numeric,
    top_titles text[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    WITH rows AS (
        SELECT * FROM public.combined_rows(p_date, p_period, p_unified, p_depth)
    ),
    named AS (
        SELECT btrim(b.author) AS nm, b.title, r.avg_rank, r.book_id, r.store_count
          FROM rows r
          JOIN books b ON b.id = r.book_id
         WHERE b.author IS NOT NULL
           AND btrim(b.author) <> ''
           AND r.store_count >= p_min_stores
    )
    SELECT nm,
           count(DISTINCT book_id)::int,
           min(avg_rank),
           round(sum(greatest(0, (p_depth + 1) - avg_rank))),
           (array_agg(title ORDER BY avg_rank))[1:3]
      FROM named
     WHERE nm <> ''
     GROUP BY nm
     ORDER BY 4 DESC, 2 DESC
     LIMIT greatest(1, least(p_limit, 300));
$$;


-- ----------------------------------------------------------------------------
--  7. 한 출판사(또는 저자)가 순위에 올린 책 목록
-- ----------------------------------------------------------------------------
--  p_field: 'publisher' 또는 'author'
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.books_of(
    p_field   text,
    p_name    text,
    p_date    date,
    p_period  text,
    p_unified text DEFAULT 'all',
    p_depth   int  DEFAULT 300,
    p_limit   int  DEFAULT 100
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
    SELECT r.book_id, b.title, b.author, b.publisher, b.cover_url,
           r.store_count, r.avg_rank, r.ranks, r.sales
      FROM public.combined_rows(p_date, p_period, p_unified, p_depth) r
      JOIN books b ON b.id = r.book_id
     WHERE CASE WHEN p_field = 'author'
                THEN btrim(b.author) = p_name
                ELSE btrim(regexp_replace(b.publisher, '\(주\)|주식회사|㈜', '', 'g')) = p_name
           END
     ORDER BY r.avg_rank
     LIMIT greatest(1, least(p_limit, 500));
$$;


-- ----------------------------------------------------------------------------
--  8. 분야 점유율 — 종합 상위권을 어떤 분야가 채우고 있나
-- ----------------------------------------------------------------------------
--  종합(전체) 상위 p_top 권이 각각 어느 분야 목록에도 올라 있는지 세어봅니다.
--
--  ⚠️ 한 권이 여러 분야에 들 수 있습니다(소설이면서 한국소설).
--    그래서 합계가 p_top 을 넘습니다. 비율이 아니라 '몇 권이 걸쳐 있나' 입니다.
--    화면에도 그렇게 적습니다.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.category_share(
    p_date   date,
    p_period text,
    p_top    int DEFAULT 100
)
RETURNS TABLE (
    unified_code text,
    label        text,
    books        int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    WITH top_books AS MATERIALIZED (
        SELECT r.book_id
          FROM public.combined_rows(p_date, p_period, 'all', p_top) r
         ORDER BY r.avg_rank
         LIMIT greatest(1, least(p_top, 500))
    ),
    -- ⚠️ 여기서 방향이 중요합니다.
    --    "그날 순위 전체를 훑어서 상위권 책을 걸러내기" 로 짜면 11만 줄을
    --    훑느라 4초가 걸렸습니다. 반대로 "상위권 책 100권의 상품번호로
    --    순위표를 찾아가기" 로 하면 색인(store_book_id)을 타서 순식간입니다.
    sbs AS MATERIALIZED (
        SELECT sb.id, sb.book_id
          FROM store_books sb
          JOIN top_books t ON t.book_id = sb.book_id
    ),
    cats AS (
        SELECT c.id, c.unified_code, c.name
          FROM categories c
         WHERE c.enabled
           AND c.kind <> 'offline'
           AND c.unified_code IS NOT NULL
           AND c.unified_code <> 'all'
           AND (CASE WHEN c.kind = 'weekly' THEN 'weekly' ELSE 'daily' END) = p_period
    ),
    hits AS (
        SELECT cats.unified_code, sbs.book_id
          FROM sbs
          JOIN rankings r ON r.store_book_id = sbs.id
                         AND r.snapshot_date = p_date
          JOIN cats     ON cats.id = r.category_id
         GROUP BY cats.unified_code, sbs.book_id
    ),
    labels AS (
        SELECT DISTINCT ON (unified_code) unified_code, name
          FROM cats ORDER BY unified_code, length(name), name
    )
    SELECT h.unified_code, l.name, count(*)::int
      FROM hits h JOIN labels l ON l.unified_code = h.unified_code
     GROUP BY h.unified_code, l.name
     ORDER BY 3 DESC;
$$;


-- ----------------------------------------------------------------------------
--  9. 도서 검색 — 한 책은 한 줄로
-- ----------------------------------------------------------------------------
--  【왜 만들었나요? — 2026-08-08 대표님 지적】
--  "상품 검색하면 하나의 도서가 예스24·알라딘·교보문고로 나뉘어서 나올
--   필요가 있을까?"
--  없습니다. 예전 검색은 '서점별 도서' 표를 그대로 보여줘서 같은 책이
--  세 줄로 나왔습니다. 이제 묶인 책(books) 기준으로 한 줄만 내보내고,
--  어느 서점에 있는지는 배지로 표시합니다.
--
--  돌려주는 값
--    stores     : 이 책이 있는 서점 번호 배열 (예: {1,2,3})
--    last_seen  : 마지막으로 순위에 있었던 날
--    best_rank  : 지금까지 기록한 가장 높은 순위
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_books_merged(
    p_q     text,
    p_limit int DEFAULT 50
)
RETURNS TABLE (
    book_id    bigint,
    title      text,
    author     text,
    publisher  text,
    pub_ym     text,
    cover_url  text,
    isbn13     text,
    stores     smallint[],
    last_seen  date,
    best_rank  int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    WITH q AS (SELECT btrim(p_q) AS term),
    -- MATERIALIZED = 한 번만 계산해서 들고 있기.
    -- 이게 없으면 아래에서 hit 를 세 번 참조할 때마다 도서 표를 다시 훑습니다.
    hit AS MATERIALIZED (
        SELECT b.id, b.title, b.author, b.publisher, b.pub_ym, b.cover_url, b.isbn13
          FROM books b, q
         WHERE q.term <> ''
           AND (b.title     ILIKE '%' || q.term || '%'
             OR b.author    ILIKE '%' || q.term || '%'
             OR b.publisher ILIKE '%' || q.term || '%')
         LIMIT 400
    ),
    agg AS (
        SELECT sb.book_id,
               array_agg(DISTINCT sb.store_id) AS stores
          FROM store_books sb
          JOIN hit ON hit.id = sb.book_id
         GROUP BY sb.book_id
    ),
    seen AS (
        SELECT sb.book_id,
               max(r.snapshot_date) AS last_seen,
               min(r.rank)::int     AS best_rank
          FROM store_books sb
          JOIN hit ON hit.id = sb.book_id
          JOIN rankings r ON r.store_book_id = sb.id
         GROUP BY sb.book_id
    )
    SELECT hit.id, hit.title, hit.author, hit.publisher, hit.pub_ym,
           hit.cover_url, hit.isbn13,
           coalesce(agg.stores, '{}'::smallint[]),
           seen.last_seen, seen.best_rank
      FROM hit
      LEFT JOIN agg  ON agg.book_id  = hit.id
      LEFT JOIN seen ON seen.book_id = hit.id, q
     -- 제목이 검색어로 '시작' 하는 책을 먼저, 그다음 최근에 순위에 있던 책
     ORDER BY (hit.title ILIKE q.term || '%') DESC,
              seen.last_seen DESC NULLS LAST,
              seen.best_rank ASC NULLS LAST
     LIMIT greatest(1, least(p_limit, 200));
$$;


-- ----------------------------------------------------------------------------
--  10. 수집 상태 요약 — 서점별로 언제 시작해서 언제 끝났는지
-- ----------------------------------------------------------------------------
--  【왜 만들었나요? — 2026-08-08 대표님 지적】
--  "수집 상태도 분까지는 나왔으면 좋겠고."
--  예전에는 날짜만 보였습니다. 이제 시작·종료 시각을 분까지 돌려줍니다.
--  (화면에서 한국시간으로 바꿔 보여줍니다)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crawl_summary(p_days int DEFAULT 7)
RETURNS TABLE (
    snapshot_date date,
    store_id      smallint,
    ok_count      int,
    fail_count    int,
    items         bigint,
    started_at    timestamptz,
    finished_at   timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT l.snapshot_date,
           l.store_id,
           count(*) FILTER (WHERE l.status = 'success')::int,
           count(*) FILTER (WHERE l.status <> 'success')::int,
           sum(l.items_collected)::bigint,
           min(l.started_at),
           max(coalesce(l.finished_at, l.started_at))
      FROM crawl_logs l
     WHERE l.snapshot_date >= (
             SELECT max(snapshot_date) FROM crawl_logs
           ) - greatest(0, least(p_days, 90))
     GROUP BY l.snapshot_date, l.store_id
     ORDER BY l.snapshot_date DESC, l.store_id;
$$;


-- ----------------------------------------------------------------------------
--  11. 자료 점검 — 한 책 안에 서로 다른 출판사가 섞여 있지 않은지
-- ----------------------------------------------------------------------------
--  【왜 필요한가요? — 2026-08-08 대표님 지적】
--  민음사·서정시학·다산북스·문학동네의 '싯다르타' 가 한 권으로 뭉쳐
--  있었습니다. 규칙을 고쳤지만, 정말 고쳐졌는지는 자료로 확인해야 합니다.
--
--  이 기능은 "한 도서 마스터에 묶인 서점 상품들의 출판사가 서로 다른 경우"
--  를 찾아냅니다. 결과가 0건이어야 정상입니다.
--
--  ※ 표기만 다른 경우((주)민음사)는 정규화된 값으로 비교하므로 안 걸립니다.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publisher_conflicts(p_limit int DEFAULT 20)
RETURNS TABLE (
    book_id    bigint,
    title      text,
    publishers text[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT sb.book_id,
           min(b.title),
           array_agg(DISTINCT sb.norm_publisher ORDER BY sb.norm_publisher)
      FROM store_books sb
      JOIN books b ON b.id = sb.book_id
     WHERE sb.book_id IS NOT NULL
       AND sb.norm_publisher IS NOT NULL
       AND btrim(sb.norm_publisher) <> ''
     GROUP BY sb.book_id
    HAVING count(DISTINCT sb.norm_publisher) > 1
     ORDER BY count(DISTINCT sb.norm_publisher) DESC, sb.book_id
     LIMIT greatest(1, least(p_limit, 200));
$$;


-- ----------------------------------------------------------------------------
--  12. 사이트(공개용 열쇠)가 이 기능들을 쓸 수 있게 허용
-- ----------------------------------------------------------------------------
--  둘 다 읽기 전용이고 SECURITY INVOKER 라 보안 잠금을 우회하지 않습니다.
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.snapshot_dates(int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.combined_rows(date, text, text, int)
    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.combined_best(date, text, text, int, int, int)
    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publisher_ranking(date, text, text, int, int, int)
    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.author_ranking(date, text, text, int, int, int)
    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.books_of(text, text, date, text, text, int, int)
    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.category_share(date, text, int)
    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_books_merged(text, int)
    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crawl_summary(int)
    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publisher_conflicts(int)
    TO anon, authenticated;


-- ============================================================================
--  확인: 아래를 실행하면 결과가 바로 나와야 합니다 (몇 십 밀리초)
-- ============================================================================
--  SELECT * FROM snapshot_dates(14);
--  SELECT * FROM combined_best((SELECT max(snapshot_date) FROM rankings),
--                              'daily', 'all', 2, 300, 20);
-- ============================================================================
