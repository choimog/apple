-- ============================================================================
--  공유 링크 — 로그인 없이 순위표 하나만 보여주기
-- ============================================================================
--
--  【무엇인가요?】
--  계정을 안 만들어 드릴 분에게도 **특정 분야 순위표 하나만** 보여 드리는
--  긴 주소를 만듭니다. 대표님이 언제든 끌 수 있습니다.
--
--      https://우리사이트/s/8f3a9c1b...
--
--  【왜 이렇게 복잡한가요?】
--  db/auth.sql 로 잠근 뒤에는 **로그인 안 한 사람은 표를 하나도 못 읽습니다.**
--  그래서 "이 주소를 가진 사람에게만, 이 분야만" 을 열어주려면 문을 따로
--  하나 내야 합니다. 그게 아래 함수들입니다.
--
--  문을 여는 방식이 중요합니다.
--    · 표를 통째로 열어주지 않습니다
--    · 함수가 **주소값(토큰)을 먼저 확인**하고, 통과한 것만 그 분야의
--      순위 줄을 돌려줍니다
--    · 꺼졌거나(enabled=false) 기한이 지난 링크는 아무것도 안 돌려줍니다
--
--  【실행 방법】
--  Supabase → SQL Editor → New query → 아래 전체 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다.
--  ⚠️ db/auth.sql 을 먼저 실행하셨어야 합니다.
-- ============================================================================


-- ---------------------------------------------------------------------------
--  1. 무엇을 공유할 수 있는지 넓힙니다
-- ---------------------------------------------------------------------------
--  처음 표를 만들 때는 'book'(도서 상세) 과 'report'(리포트) 만 생각했는데,
--  실제로 필요한 것은 **순위표** 였습니다.
-- ---------------------------------------------------------------------------
ALTER TABLE public_links DROP CONSTRAINT IF EXISTS public_links_kind_check;
ALTER TABLE public_links ADD CONSTRAINT public_links_kind_check
    CHECK (kind IN ('ranking', 'book', 'report'));

-- 사람이 알아볼 이름 (예: "알라딘 소설 일간"). 없어도 동작합니다.
ALTER TABLE public_links ADD COLUMN IF NOT EXISTS label text;

COMMENT ON COLUMN public_links.label IS '관리 화면에 보일 이름';
COMMENT ON COLUMN public_links.target_id IS
    'ranking 이면 분야 번호(categories.id). 날짜를 고정하려면 "12@2026-08-09"';


-- ---------------------------------------------------------------------------
--  2. 링크 만들기 — 관리자만
-- ---------------------------------------------------------------------------
--  주소값(토큰)은 **데이터베이스가** 만듭니다.
--  화면에서 만들어 보내게 하면, 짧거나 예측 가능한 값이 섞여 들어옵니다.
--  여기서 만들면 항상 32글자짜리 무작위 값입니다.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_share_link(
    p_kind      text,
    p_target_id text,
    p_label     text DEFAULT NULL,
    p_days      int  DEFAULT NULL      -- NULL 이면 기한 없음
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token text;
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION '관리자만 공유 링크를 만들 수 있습니다';
    END IF;
    IF p_kind NOT IN ('ranking', 'book', 'report') THEN
        RAISE EXCEPTION '알 수 없는 공유 종류: %', p_kind;
    END IF;

    -- 64글자 무작위. 주소에 그대로 들어가므로 기호 없는 글자만 씁니다.
    --
    -- ⚠️ 처음에는 encode(gen_random_bytes(24),'hex') 를 썼는데, 이건
    --    pgcrypto 라는 '확장 기능' 이 있어야 하고 Supabase 에서는 그것이
    --    public 이 아니라 extensions 라는 곳에 설치돼 있습니다. 이 함수는
    --    안전을 위해 public 만 보도록 묶여 있어서 못 찾습니다.
    --    → 대표님 데이터베이스에서 '링크 만들기' 가 실패했을 겁니다.
    --    gen_random_uuid() 는 PostgreSQL 에 기본으로 들어 있어 확장이
    --    필요 없고, 무작위 정도도 충분합니다. (2026-08-09 시험에서 잡음)
    v_token := replace(gen_random_uuid()::text, '-', '')
            || replace(gen_random_uuid()::text, '-', '');

    INSERT INTO public_links (token, kind, target_id, label, created_by, expires_at)
    VALUES (
        v_token, p_kind, p_target_id, p_label, auth.uid(),
        CASE WHEN p_days IS NULL THEN NULL ELSE now() + (p_days || ' days')::interval END
    );
    RETURN v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION create_share_link(text, text, text, int) TO authenticated;


-- ---------------------------------------------------------------------------
--  3. 링크 켜고 끄기 — 관리자만
-- ---------------------------------------------------------------------------
--  지우지 않고 끕니다. 지우면 "그런 링크가 있었나" 를 확인할 수 없습니다.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_share_link(p_token text, p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_hit int;
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION '관리자만 공유 링크를 바꿀 수 있습니다';
    END IF;
    UPDATE public_links SET enabled = p_enabled WHERE token = p_token;
    GET DIAGNOSTICS v_hit = ROW_COUNT;
    RETURN v_hit > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION set_share_link(text, boolean) TO authenticated;


-- ---------------------------------------------------------------------------
--  4. 관리자가 링크 목록 보기
-- ---------------------------------------------------------------------------
--  public_links 표 자체는 계속 잠겨 있습니다(주소값이 새면 안 되니까요).
--  대신 이 함수로만 봅니다.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION my_share_links()
RETURNS TABLE (
    token       text,
    kind        text,
    target_id   text,
    label       text,
    enabled     boolean,
    created_at  timestamptz,
    expires_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION '관리자만 볼 수 있습니다';
    END IF;
    RETURN QUERY
    SELECT l.token::text, l.kind::text, l.target_id::text, l.label::text,
           l.enabled, l.created_at, l.expires_at
    FROM public_links l
    ORDER BY l.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION my_share_links() TO authenticated;


-- ---------------------------------------------------------------------------
--  5. 주소값이 살아 있는지 확인 — 로그인 없이 부를 수 있는 유일한 통로
-- ---------------------------------------------------------------------------
--  ⚠️ 여기서 '없는 링크' 와 '꺼진 링크' 를 구분해서 알려주지 않습니다.
--     구분해 주면 주소값을 하나씩 넣어보며 "있다/없다" 를 알아낼 수 있습니다.
--     둘 다 그냥 빈 결과입니다.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION share_meta(p_token text)
RETURNS TABLE (
    kind          text,
    label         text,
    category_id   int,
    category_name text,
    branch_name   text,
    store_id      smallint,
    kcategory_kind text,
    snapshot_date date
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    l           public_links%ROWTYPE;
    v_cat_id    int;
    v_fixed     date;
BEGIN
    SELECT * INTO l FROM public_links
    WHERE token = p_token AND enabled
      AND (expires_at IS NULL OR expires_at > now());
    IF NOT FOUND THEN
        RETURN;                       -- 없는 것도, 꺼진 것도 똑같이 빈 결과
    END IF;

    IF l.kind <> 'ranking' THEN
        RETURN;                       -- 지금은 순위표만 지원합니다
    END IF;

    -- target_id 는 "분야번호" 또는 "분야번호@날짜"
    v_cat_id := split_part(l.target_id, '@', 1)::int;
    IF position('@' in l.target_id) > 0 THEN
        v_fixed := split_part(l.target_id, '@', 2)::date;
    END IF;

    RETURN QUERY
    SELECT
        l.kind::text,
        l.label::text,
        c.id::int,
        c.name::text,
        c.branch_name::text,
        c.store_id::smallint,
        c.kind::text,
        COALESCE(
            v_fixed,
            (SELECT max(r.snapshot_date) FROM rankings r WHERE r.category_id = c.id)
        )
    FROM categories c
    WHERE c.id = v_cat_id;
END;
$$;

GRANT EXECUTE ON FUNCTION share_meta(text) TO anon, authenticated;


-- ---------------------------------------------------------------------------
--  6. 공유된 순위표 읽기 — 로그인 없이
-- ---------------------------------------------------------------------------
--  주소값이 통과해야만 그 분야의 줄을 돌려줍니다.
--  다른 분야는 같은 주소로 못 봅니다.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION share_rankings(p_token text, p_limit int DEFAULT 100)
RETURNS TABLE (
    rank          int,
    sales_point   int,
    raw_title     text,
    raw_author    text,
    raw_publisher text,
    pub_ym        text,
    cover_url     text,
    store_id      smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    l        public_links%ROWTYPE;
    v_cat_id int;
    v_date   date;
    v_limit  int;
BEGIN
    SELECT * INTO l FROM public_links
    WHERE token = p_token AND enabled
      AND (expires_at IS NULL OR expires_at > now());
    IF NOT FOUND OR l.kind <> 'ranking' THEN
        RETURN;
    END IF;

    v_cat_id := split_part(l.target_id, '@', 1)::int;
    IF position('@' in l.target_id) > 0 THEN
        v_date := split_part(l.target_id, '@', 2)::date;
    ELSE
        SELECT max(r.snapshot_date) INTO v_date
        FROM rankings r WHERE r.category_id = v_cat_id;
    END IF;

    -- 한 번에 너무 많이 못 가져가게 막습니다 (자료를 통째로 퍼가는 것 방지)
    v_limit := least(greatest(COALESCE(p_limit, 100), 1), 300);

    -- ⚠️ 형(型)을 하나하나 맞춰 줍니다.
    --    rankings.rank 는 smallint 인데 위에서 int 로 적어 두면
    --    "구조가 안 맞습니다" 오류가 납니다. 화면에는 그냥 '자료 없음' 처럼
    --    보여서 원인을 못 찾습니다. (2026-08-09 시험에서 잡음)
    RETURN QUERY
    SELECT r.rank::int, r.sales_point::int,
           sb.raw_title::text, sb.raw_author::text, sb.raw_publisher::text,
           sb.pub_ym::text, sb.cover_url::text, sb.store_id::smallint
    FROM rankings r
    JOIN store_books sb ON sb.id = r.store_book_id
    WHERE r.category_id = v_cat_id AND r.snapshot_date = v_date
    ORDER BY r.rank
    LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION share_rankings(text, int) TO anon, authenticated;


-- ---------------------------------------------------------------------------
--  7. 확인
-- ---------------------------------------------------------------------------
--  아래 4줄이 전부 ✅ 면 끝입니다.
-- ---------------------------------------------------------------------------
SELECT * FROM (
    SELECT 1 AS "번호", '공유 종류에 ranking 포함' AS "확인 항목",
           CASE WHEN EXISTS (
               SELECT 1 FROM pg_constraint
               WHERE conname = 'public_links_kind_check'
                 AND pg_get_constraintdef(oid) LIKE '%ranking%'
           ) THEN '✅' ELSE '❌ 이 파일을 다시 실행하세요' END AS "판정"
    UNION ALL
    SELECT 2, '링크 만들기 함수',
           CASE WHEN to_regprocedure('create_share_link(text,text,text,int)') IS NOT NULL
                THEN '✅' ELSE '❌' END
    UNION ALL
    SELECT 3, '로그인 없이 읽는 함수',
           CASE WHEN to_regprocedure('share_rankings(text,int)') IS NOT NULL
                THEN '✅' ELSE '❌' END
    UNION ALL
    SELECT 4, 'public_links 표는 여전히 잠겨 있음',
           CASE WHEN NOT EXISTS (
               SELECT 1 FROM pg_policy p
               JOIN pg_class c ON c.oid = p.polrelid
               WHERE c.relname = 'public_links' AND p.polcmd = 'r'
           ) THEN '✅ 주소값은 함수로만 나갑니다' ELSE '❌ 표가 열려 있습니다' END
) x ORDER BY "번호";
