-- ===========================================================================
--  잠든 도서 자료 찾기 — [도서 목록 정리] 버튼이 쓰는 계산
-- ===========================================================================
--
--  【2026-08-18 대표님 지시】
--    "매일 쌓이는 데이터 중에서 14일 동안 단 한 차례도 사용되지 않거나
--     업데이트 되지 않는 데이터들은 제거 또는 보관함으로 알아서 보내주면
--     좋겠어. 대신, 3사 서점 중에 단 한 차례라도 쓰였다면 지울 수 없도록
--     해주고."
--
--  【이 파일이 하는 일】
--  **아무것도 지우지 않습니다.** 지워도 되는 것을 '고르기만' 합니다.
--  실제로 지우는 일은 GitHub 의 [도서 목록 정리] 버튼이 합니다.
--  그 버튼은 지우기 전에 파일로 먼저 빼내고, 그 파일을 다시 내려받아
--  확인한 다음에야 지웁니다.
--
--  ▶ 이 파일은 **한 번만** 실행하시면 됩니다. 계산 방법을 등록하는 것뿐입니다.
--
--  실행: Supabase → SQL Editor → New query → 전체 붙여넣고 Run (몇 초)
-- ===========================================================================


-- ---------------------------------------------------------------------------
--  이 파일을 돌릴 수 있는 상태인지 먼저 봅니다
-- ---------------------------------------------------------------------------
DO $guard$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'store_books'
                      AND column_name = 'last_seen_at') THEN
        RAISE EXCEPTION E'store_books 표에 last_seen_at 칸이 없습니다.\n\ndb/schema.sql 을 먼저 실행해 주세요.';
    END IF;
END
$guard$;


-- ---------------------------------------------------------------------------
--  ① 잠든 상품 고르기
-- ---------------------------------------------------------------------------
--  【'살아 있다' 의 뜻 — 셋 중 하나만 해당해도 살아 있습니다】
--
--    ㉠ 최근 N일 안에 서점 목록에서 보였다   (last_seen_at)
--       ※ 순위에 들었든 안 들었든, 목록에 이름이 있었으면 갱신됩니다.
--         "사용되거나 업데이트 된" 것이 바로 이것입니다.
--
--    ㉡ 순위 기록이 아직 데이터베이스에 남아 있다
--       🚨 이게 가장 중요한 안전장치입니다. 상품을 지우면 데이터베이스가
--          그 상품의 **순위 기록까지 함께 지웁니다**(ON DELETE CASCADE).
--          그래서 순위가 한 줄이라도 남아 있으면 절대 안 건드립니다.
--          보관소로 이미 빠져나간 뒤에야 지울 수 있게 됩니다.
--
--    ㉢ 대표님이 손으로 내리신 결정(같은 책/다른 책)이 걸려 있다
--       그 결정도 함께 지워지기 때문입니다. 이건 영구히 남깁니다.
--
--  【🚨 3사 중 한 서점이라도 살아 있으면 묶음 전체를 살립니다】
--  대표님 지시의 핵심입니다. 이게 없으면 이런 일이 생깁니다.
--
--      『긴긴밤』  교보 300위 안 (살아 있음)
--                예스24 순위 밖 (잠듦)  ← 여기만 지우면?
--                알라딘 순위 밖 (잠듦)
--
--  교보 줄만 남으면 사이트가 "예스24·알라딘에는 안 묶임" 이라고 적습니다.
--  실제로는 있는 책인데 **없는 것처럼** 보입니다. 그래서 한 서점이라도
--  살아 있으면 나머지 두 서점 줄도 그대로 둡니다.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dormant_store_books(
    p_days  int DEFAULT 14,
    p_limit int DEFAULT 200000
)
RETURNS TABLE (id bigint, book_id bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    WITH alive AS MATERIALIZED (
        SELECT sb.id, sb.book_id
          FROM store_books sb
         WHERE sb.last_seen_at >= now() - make_interval(days => greatest(p_days, 1))
            OR EXISTS (SELECT 1 FROM rankings r
                        WHERE r.store_book_id = sb.id)
            OR EXISTS (SELECT 1 FROM book_matches m
                        WHERE m.decision IN ('manual_merge', 'manual_split')
                          AND (m.store_book_a = sb.id OR m.store_book_b = sb.id))
    ),
    -- 살아 있는 줄이 하나라도 속한 묶음
    alive_books AS MATERIALIZED (
        SELECT DISTINCT a.book_id FROM alive a WHERE a.book_id IS NOT NULL
    )
    SELECT sb.id, sb.book_id
      FROM store_books sb
     -- 자기 자신이 살아 있지 않고
     WHERE NOT EXISTS (SELECT 1 FROM alive a WHERE a.id = sb.id)
     -- 같은 묶음의 다른 서점도 살아 있지 않을 때만
     --  ⚠️ book_id 가 NULL(아직 안 묶인 상품)이면 이 조건은 항상 참입니다.
     --     묶이지 않은 상품은 혼자이므로 저 혼자 판단하면 됩니다.
       AND NOT EXISTS (SELECT 1 FROM alive_books ab
                        WHERE ab.book_id = sb.book_id)
     ORDER BY sb.id
     LIMIT greatest(p_limit, 1);
$$;


-- ---------------------------------------------------------------------------
--  ② 딸린 서점 줄이 하나도 없어진 묶음 고르기
-- ---------------------------------------------------------------------------
--  ① 로 상품을 지우고 나면 껍데기만 남은 묶음이 생깁니다. 그것을 찾습니다.
--  ⚠️ 지우기 **전에** 부르면 아무것도 안 나옵니다. 그게 정상입니다.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orphan_books(p_limit int DEFAULT 200000)
RETURNS TABLE (id bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT b.id
      FROM books b
     WHERE NOT EXISTS (SELECT 1 FROM store_books s WHERE s.book_id = b.id)
     ORDER BY b.id
     LIMIT greatest(p_limit, 1);
$$;


-- ---------------------------------------------------------------------------
--  ③ 미리 세어 보기 — 얼마나 지워질지 눈으로 확인
-- ---------------------------------------------------------------------------
--  [도서 목록 정리] 버튼의 '확인만' 도 이것을 씁니다.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dormant_summary(p_days int DEFAULT 14)
RETURNS TABLE (
    label     text,
    n         bigint,
    note      text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    WITH d AS MATERIALIZED (
        SELECT * FROM dormant_store_books(p_days, 2000000)
    )
    SELECT '전체 상품'::text, count(*)::bigint, ''::text FROM store_books
    UNION ALL
    SELECT '  └ 잠든 상품 (지울 대상)', count(*)::bigint,
           p_days || '일간 안 보이고 순위도 안 남은 것'
      FROM d
    UNION ALL
    SELECT '  └ 그 묶음 수', count(DISTINCT book_id)::bigint, ''
      FROM d WHERE book_id IS NOT NULL
    UNION ALL
    SELECT '전체 묶음', count(*)::bigint, '' FROM books
    UNION ALL
    SELECT '🚨 대표님이 내리신 결정', count(*)::bigint,
           '이 숫자는 정리 뒤에도 그대로여야 합니다'
      FROM book_matches WHERE decision IN ('manual_merge', 'manual_split')
    UNION ALL
    SELECT '🚨 순위가 남아 지울 수 없는 상품', count(*)::bigint,
           '보관소로 빠진 뒤에야 지울 수 있습니다'
      FROM store_books sb
     WHERE sb.last_seen_at < now() - make_interval(days => greatest(p_days, 1))
       AND EXISTS (SELECT 1 FROM rankings r WHERE r.store_book_id = sb.id);
$$;


-- ---------------------------------------------------------------------------
--  ④ 색인 — last_seen_at 으로 고르는 일이 매일 돌기 때문에
-- ---------------------------------------------------------------------------
--  ⚠️ 색인도 자리를 먹습니다(수십 MB). 그런데 이게 없으면 매일 상품 표를
--     통째로 훑습니다. 지금은 7만 줄이라 괜찮지만, 이 정리 장치의 목적이
--     '표가 커지지 않게 하는 것' 이므로 표는 계속 이 크기에 머뭅니다.
--     그래서 **일부러 안 만듭니다.** 7만 줄 훑기는 1초도 안 걸립니다.
--     (나중에 느려지면 그때 아래 한 줄을 살리면 됩니다)
--
--  CREATE INDEX IF NOT EXISTS idx_store_books_last_seen
--      ON store_books(last_seen_at);
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
--  누가 쓸 수 있게 할지
-- ---------------------------------------------------------------------------
--  🚨 사이트 방문자는 이 계산을 부를 이유가 없습니다.
--     GitHub 작업(관리자 열쇠)만 부릅니다.
--     그래서 anon / authenticated 에는 권한을 주지 않습니다.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.dormant_store_books(int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.orphan_books(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dormant_summary(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dormant_store_books(int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.orphan_books(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.dormant_summary(int) TO service_role;


-- ---------------------------------------------------------------------------
--  확인 — 지금 상태로 얼마나 지워질지 미리 봅니다 (지우지 않습니다)
-- ---------------------------------------------------------------------------
SELECT "항목", to_char("건수", 'FM999,999,999') AS "건수", "참고" FROM (
    SELECT label AS "항목", n AS "건수", note AS "참고",
           row_number() OVER () AS ord
      FROM dormant_summary(14)
) x ORDER BY ord;
