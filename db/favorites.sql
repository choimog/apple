-- ============================================================================
--  즐겨찾기 — 회원마다 자기가 고른 도서만 모아 보기
-- ============================================================================
--
--  【2026-08-18 대표님 요청】
--    "각 아이디 이용자마다 도서를 즐겨찾기 할 수 있는 기능을 하나 추가할 수
--     있을까? 즐겨찾기한 도서는 종합탭에 있는 것처럼, 내가 선택한 도서들의
--     3사 자료가 보이게끔.
--     그리고 즐겨찾기 목록에 있는 도서가 장기간 업데이트가 안 돼서 지워질
--     경우, 그 이용자에게 매일 어떤 도서가 지워졌다고 안내문 정도만 남길 수
--     있나?"
--
--  【실행 방법】
--  Supabase → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다.
--  ⚠️ db/auth.sql 을 먼저 실행하셨어야 합니다 (회원 구분이 필요합니다).
--
--  【용량】
--  한 줄에 100바이트 남짓입니다. 회원 10명이 100권씩 담아도 0.1MB 입니다.
--  [저장 용량] 화면의 숫자에 눈에 띄는 영향을 주지 않습니다.
-- ============================================================================


-- ---------------------------------------------------------------------------
--  1. 표
-- ---------------------------------------------------------------------------
--  🚨 book_id 를 지우지 않고 **비웁니다** (ON DELETE SET NULL).
--
--  그냥 같이 지우면(CASCADE) 대표님 목록에서 책이 **소리 없이 사라집니다.**
--  "내가 지운 건가?" 하고 헷갈리실 수밖에 없습니다. 그래서 줄은 남기고
--  제목만 남겨 둔 채 '사라졌다' 고 적습니다.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS favorites (
    id         bigserial   PRIMARY KEY,
    user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    book_id    bigint      REFERENCES books(id) ON DELETE SET NULL,

    -- 책이 지워진 뒤에도 무엇이었는지 알 수 있게 이름을 함께 적어 둡니다.
    -- (담을 때 한 번 적고, 지워질 때 아래 장치가 마지막 값으로 고칩니다)
    title      text        NOT NULL,
    author     text,
    publisher  text,

    added_at   timestamptz NOT NULL DEFAULT now(),
    -- 책이 지워진 시각. 비어 있으면 멀쩡히 있는 것입니다.
    removed_at timestamptz,
    -- 대표님이 안내문을 확인하신 시각. 확인 전까지만 안내문이 뜹니다.
    noticed_at timestamptz
);

COMMENT ON TABLE favorites IS '회원별 즐겨찾기 도서 (2026-08-18)';
COMMENT ON COLUMN favorites.removed_at IS
    '자료 정리로 책이 사라진 시각. 비어 있으면 정상';

-- 같은 책을 두 번 담지 못하게. 사라진 줄(book_id 가 빈 줄)은 예외입니다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_favorites_one
    ON favorites(user_id, book_id) WHERE book_id IS NOT NULL;

-- 책이 지워질 때 그 책을 담아 둔 줄을 찾아야 합니다.
CREATE INDEX IF NOT EXISTS idx_favorites_book ON favorites(book_id)
    WHERE book_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);


-- ---------------------------------------------------------------------------
--  2. 남의 즐겨찾기는 못 봅니다
-- ---------------------------------------------------------------------------
--  🚨 화면만 막으면 소용없습니다. 공개용 열쇠는 브라우저 안에 그대로 들어
--     있어서, 사이트를 거치지 않고 직접 물어볼 수 있습니다.
--     여기서 막아야 진짜로 막힙니다.
-- ---------------------------------------------------------------------------
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "내 것만 보기"   ON favorites;
DROP POLICY IF EXISTS "내 것만 담기"   ON favorites;
DROP POLICY IF EXISTS "내 것만 고치기" ON favorites;
DROP POLICY IF EXISTS "내 것만 빼기"   ON favorites;

CREATE POLICY "내 것만 보기" ON favorites
    FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "내 것만 담기" ON favorites
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- 고칠 수 있는 것은 '안내문 확인' 과 '다시 잇기' 뿐입니다 (아래 GRANT 참고).
CREATE POLICY "내 것만 고치기" ON favorites
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "내 것만 빼기" ON favorites
    FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON favorites TO authenticated;
-- 아무 칸이나 고치지는 못합니다. 남의 줄을 내 것으로 바꿔치기하는 길을
-- 아예 열지 않습니다 (user_id 는 여기에 없습니다).
--
-- ⚠️ removed_at 도 들어 있어야 합니다. 아래 relink_my_favorites() 가
--    '다시 찾았으니 사라진 것이 아니다' 로 되돌릴 때 이 칸을 씁니다.
--    빠뜨리면 다시 잇기가 통째로
--    "permission denied for table favorites" 로 실패합니다.
--    (2026-08-18 실제로 그렇게 만들었다가 시험용 데이터베이스에서 잡음)
GRANT UPDATE (book_id, title, author, publisher, removed_at, noticed_at)
    ON favorites TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE favorites_id_seq TO authenticated;

REVOKE ALL ON favorites FROM anon;


-- ---------------------------------------------------------------------------
--  3. 책이 지워질 때 '사라졌다' 고 적어 둡니다
-- ---------------------------------------------------------------------------
--  책은 두 가지 경우에 지워집니다.
--    ① [도서 목록 정리] — 14일 동안 아무 서점에도 안 올라온 자료
--    ② [도서 매칭] — 묶음이 바뀌어 빈 껍데기가 된 도서 마스터
--
--  ⚠️ ②는 **자료가 없어진 것이 아닙니다.** 같은 책이 다른 번호로 다시
--     생깁니다. 그래서 이것까지 "지워졌습니다" 라고 알리면 거짓 경보가
--     매일 뜹니다 (2026-08-18 실행에서만 552종이 그랬습니다).
--     그래서 화면이 먼저 **이름이 똑같은 책을 다시 찾아 이어 줍니다**
--     (아래 relink_my_favorites). 못 찾은 것만 안내문이 됩니다.
--
--  이 장치는 지우기 **직전**에 돌기 때문에, 그 시점의 마지막 제목을
--  그대로 남길 수 있습니다.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION favorites_book_gone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER          -- 남의 즐겨찾기 줄도 표시해야 하므로
SET search_path = public
AS $$
BEGIN
    UPDATE favorites
       SET removed_at = now(),
           noticed_at = NULL,                       -- 다시 알려 드립니다
           title      = coalesce(OLD.title, title),
           author     = coalesce(OLD.author, author),
           publisher  = coalesce(OLD.publisher, publisher)
     WHERE book_id = OLD.id;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS favorites_book_gone ON books;
CREATE TRIGGER favorites_book_gone
    BEFORE DELETE ON books
    FOR EACH ROW
    EXECUTE FUNCTION favorites_book_gone();


-- ---------------------------------------------------------------------------
--  4. 번호만 바뀐 책을 다시 이어 줍니다
-- ---------------------------------------------------------------------------
--  [도서 매칭] 은 묶음이 바뀌면 도서 번호를 새로 매깁니다. 그러면 담아
--  두신 책이 '사라진 것' 처럼 보입니다. 실제로는 멀쩡히 있습니다.
--
--  🚨 **이름이 정확히 같은 책이 딱 하나일 때만** 잇습니다.
--     여럿이면 어느 것인지 알 수 없으므로 **잇지 않고 그대로 둡니다.**
--     짐작해서 이어 놓으면 대표님이 담지도 않은 책이 목록에 생깁니다.
--
--  내 줄만 손댑니다 (SECURITY INVOKER + 위의 보안 규칙).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION relink_my_favorites()
RETURNS int
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_n int := 0;
BEGIN
    WITH gone AS (
        SELECT f.id, f.title, f.author, f.publisher
          FROM favorites f
         WHERE f.user_id = auth.uid()
           AND f.book_id IS NULL
    ),
    found AS (
        SELECT g.id,
               -- ⚠️ LIMIT 1 이어야 합니다. 두 줄이 오면 조회가 통째로
               --    오류를 냅니다. 여러 개인지는 아래 n 으로 거릅니다.
               (SELECT b.id FROM books b
                 WHERE b.title = g.title
                   AND b.author IS NOT DISTINCT FROM g.author
                   AND b.publisher IS NOT DISTINCT FROM g.publisher
                 LIMIT 1) AS book_id,
               (SELECT count(*) FROM books b
                 WHERE b.title = g.title
                   AND b.author IS NOT DISTINCT FROM g.author
                   AND b.publisher IS NOT DISTINCT FROM g.publisher) AS n
          FROM gone g
    )
    UPDATE favorites f
       SET book_id = found.book_id, removed_at = NULL, noticed_at = NULL
      FROM found
     WHERE f.id = found.id
       AND found.n = 1                       -- 딱 하나일 때만
       -- 이미 같은 책을 담아 두셨으면 잇지 않습니다 (한 줄 규칙)
       AND NOT EXISTS (
           SELECT 1 FROM favorites o
            WHERE o.user_id = f.user_id AND o.book_id = found.book_id
       );
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;

GRANT EXECUTE ON FUNCTION relink_my_favorites() TO authenticated;


-- ---------------------------------------------------------------------------
--  5. 즐겨찾기한 책의 3사 자료 (종합 화면과 같은 모양)
-- ---------------------------------------------------------------------------
--  p_unified 에 '*' 를 주면 **모든 분야 중 가장 높은 순위**를 씁니다.
--  (종합 목록에는 없지만 소설 3위인 책을 '순위 없음' 으로 적지 않기 위함)
--
--  ⚠️ 순위가 하나도 없는 책도 **줄을 돌려줍니다.** 담아 두신 책이 목록에서
--     소리 없이 사라지면 안 됩니다. 그럴 때 store_count 는 0,
--     avg_rank 는 빈 값입니다. 0 으로 채우지 않습니다.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.books_by_ids(
    p_ids     bigint[],
    p_date    date,
    p_period  text,
    p_unified text DEFAULT 'all',
    p_depth   int  DEFAULT 300
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
    -- ⚠️ 방향이 중요합니다. 그날 순위 11만 줄을 훑는 대신, 담아 두신 책의
    --    상품번호로 순위표를 찾아갑니다 (색인을 탑니다).
    WITH sbs AS MATERIALIZED (
        SELECT sb.id, sb.book_id
          FROM store_books sb
         WHERE sb.book_id = ANY(p_ids)
    ),
    cats AS (
        SELECT c.id, c.store_id
          FROM categories c
         WHERE c.enabled
           AND c.kind <> 'offline'
           AND (CASE WHEN c.kind = 'weekly' THEN 'weekly' ELSE 'daily' END) = p_period
           AND (p_unified = '*' OR c.unified_code = p_unified)
    ),
    per_store AS (
        SELECT s.book_id,
               cats.store_id,
               min(r.rank) AS best_rank,
               (array_agg(r.sales_point ORDER BY r.rank))[1] AS sales_point
          FROM rankings r
          JOIN sbs  s    ON s.id    = r.store_book_id
          JOIN cats      ON cats.id = r.category_id
         WHERE r.snapshot_date = p_date
           AND r.rank <= p_depth
         GROUP BY s.book_id, cats.store_id
    )
    SELECT b.id, b.title, b.author, b.publisher, b.cover_url,
           count(ps.store_id)::int,
           round(avg(ps.best_rank), 1),
           coalesce(
               jsonb_object_agg(ps.store_id::text, ps.best_rank)
                   FILTER (WHERE ps.store_id IS NOT NULL),
               '{}'::jsonb),
           coalesce(
               jsonb_object_agg(ps.store_id::text, ps.sales_point)
                   FILTER (WHERE ps.sales_point IS NOT NULL),
               '{}'::jsonb)
      FROM books b
      LEFT JOIN per_store ps ON ps.book_id = b.id
     WHERE b.id = ANY(p_ids)
     GROUP BY b.id, b.title, b.author, b.publisher, b.cover_url;
$$;

GRANT EXECUTE ON FUNCTION public.books_by_ids(bigint[], date, text, text, int)
    TO authenticated;


-- ============================================================================
--  확인 — 아래를 실행하면 오류 없이 결과가 나와야 합니다
-- ============================================================================
--  SELECT count(*) FROM favorites;                       -- 0 이 정상
--  SELECT * FROM books_by_ids(ARRAY[]::bigint[],
--                             current_date, 'daily', 'all', 300);
-- ============================================================================
