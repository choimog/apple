-- ===========================================================================
--  공유 링크를 회원 모두가 만들 수 있게 — 2026-08-09 대표님 요청
-- ===========================================================================
--  "공유링크를 생성할 수 있는 기능을 다른 사람들한테도 오픈해달란 말이었어."
--
--  【먼저 읽어 주세요 — 무엇이 달라지나요?】
--  지금까지는 대표님만 링크를 만들 수 있었습니다. 이걸 실행하면
--  **로그인한 회원 누구나** 링크를 만들 수 있게 됩니다.
--
--  ⚠️ 이건 "내 자료를 남에게 보여줄 권한" 을 나눠 주는 일입니다.
--     친구 한 명이 만든 주소를 그 친구가 단톡방에 올리면, 그 방 사람들이
--     전부 그 순위표를 봅니다. 회원 전용으로 막아 둔 의미가 그만큼 옅어집니다.
--     보안 구멍은 아닙니다 (아래 '무엇을 못 하나' 참고). 다만 **자료가
--     퍼지는 통로가 대표님 손을 떠난다**는 점은 분명히 알고 계셔야 합니다.
--
--  【그래서 안전장치를 함께 넣습니다】
--   1. 누가 만들었는지 기록하고, 관리자 목록에 **이메일이 보입니다**
--   2. 한 사람이 살아 있는 링크를 **2개까지만** 만들 수 있습니다
--   3. 회원이 만든 링크는 **최대 3시간** 뒤 자동으로 꺼집니다
--      대표님만 '기한 없음' 과 긴 기한을 고를 수 있습니다
--   4. 회원은 **자기가 만든 링크만** 보고 끕니다.
--      대표님은 전부 보고, 누구 것이든 끌 수 있습니다
--
--  【되돌리려면】
--  이 파일 맨 아래 '되돌리기' 부분만 실행하시면 다시 관리자 전용이 됩니다.
--
--  실행: Supabase → SQL Editor → New query → 붙여넣고 Run
--        ※ db/auth.sql 과 db/share.sql 을 먼저 실행하셨어야 합니다
-- ===========================================================================


-- ---------------------------------------------------------------------------
--  1. 설정값 — 여기 숫자만 고치면 됩니다
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS share_limits();

CREATE OR REPLACE FUNCTION share_limits()
RETURNS TABLE (max_links int, max_hours int)
LANGUAGE sql
IMMUTABLE
AS $$
    -- 한 회원이 동시에 살려 둘 수 있는 링크 수 / 회원이 고를 수 있는 최대 시간
    --
    -- 【2026-08-09 대표님 지시】
    -- "한 사람이 2개까지 만들 수 있고, 최대 3시간까지 가능하도록."
    -- 짧게 잡을수록 자료가 퍼지는 범위가 좁아집니다. 주소가 돌아다녀도
    -- 3시간이 지나면 아무것도 안 보입니다.
    SELECT 2, 3;
$$;


-- ---------------------------------------------------------------------------
--  2. 링크 만들기 — 회원 누구나 (제한 있음)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_share_link(
    p_kind      text,
    p_target_id text,
    p_label     text DEFAULT NULL,
    p_days      int  DEFAULT 30
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token   text;
    v_admin   boolean := is_admin();
    v_mine    int;
    v_max     int;
    v_maxhour int;
    v_expires timestamptz;
BEGIN
    -- 로그인은 반드시 필요합니다. 누가 만들었는지 모르는 링크는 만들지 않습니다.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION '로그인이 필요합니다';
    END IF;

    IF p_kind NOT IN ('ranking', 'book', 'report') THEN
        RAISE EXCEPTION '알 수 없는 공유 종류: %', p_kind;
    END IF;

    SELECT max_links, max_hours INTO v_max, v_maxhour FROM share_limits();

    -- ---- 회원(관리자 아님)에게만 걸리는 제한 ----
    IF NOT v_admin THEN
        -- (가) 개수 제한 — 살아 있고 기한이 안 지난 것만 셉니다
        SELECT count(*) INTO v_mine
        FROM public_links
        WHERE created_by = auth.uid()
          AND enabled
          AND (expires_at IS NULL OR expires_at > now());

        IF v_mine >= v_max THEN
            RAISE EXCEPTION
                '동시에 살려 둘 수 있는 공유 링크는 % 개까지입니다. 안 쓰는 링크를 끄거나 기한이 지나기를 기다려 주세요.',
                v_max;
        END IF;

        -- (나) 기한 제한 — 회원은 **시간 단위**로만 만들 수 있습니다.
        --      p_days 는 '몇 시간' 으로 읽습니다 (회원용 화면이 시간을 보냅니다).
        --      기한 없음(NULL)을 보내도 최대치로 잘라 버립니다.
        v_expires := now() + (least(greatest(coalesce(p_days, v_maxhour), 1),
                                    v_maxhour) || ' hours')::interval;
    ELSE
        -- 관리자는 예전처럼 '일' 단위. NULL 이면 기한 없음.
        v_expires := CASE WHEN p_days IS NULL THEN NULL
                          ELSE now() + (p_days || ' days')::interval END;
    END IF;

    -- 64글자 무작위. gen_random_uuid() 는 확장 기능 없이 쓸 수 있습니다.
    v_token := replace(gen_random_uuid()::text, '-', '')
            || replace(gen_random_uuid()::text, '-', '');

    INSERT INTO public_links (token, kind, target_id, label, created_by, expires_at)
    VALUES (v_token, p_kind, p_target_id, p_label, auth.uid(), v_expires);
    RETURN v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION create_share_link(text, text, text, int) TO authenticated;


-- ---------------------------------------------------------------------------
--  3. 링크 켜고 끄기 — 자기 것은 자기가, 관리자는 전부
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
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION '로그인이 필요합니다';
    END IF;

    -- ⚠️ 관리자가 아니면 **자기가 만든 것만** 건드릴 수 있습니다.
    --    이 조건이 빠지면 회원이 남의 링크를 끌 수 있습니다.
    UPDATE public_links
       SET enabled = p_enabled
     WHERE token = p_token
       AND (is_admin() OR created_by = auth.uid());

    GET DIAGNOSTICS v_hit = ROW_COUNT;
    RETURN v_hit > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION set_share_link(text, boolean) TO authenticated;


-- ---------------------------------------------------------------------------
--  4. 링크 목록 — 회원은 자기 것, 관리자는 전부 (+ 만든 사람 이메일)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS my_share_links();

CREATE OR REPLACE FUNCTION my_share_links()
RETURNS TABLE (
    token       text,
    kind        text,
    target_id   text,
    label       text,
    enabled     boolean,
    created_at  timestamptz,
    expires_at  timestamptz,
    owner_email text,
    is_mine     boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION '로그인이 필요합니다';
    END IF;

    RETURN QUERY
    SELECT l.token::text, l.kind::text, l.target_id::text, l.label::text,
           l.enabled, l.created_at, l.expires_at,
           -- 🚨 관리자에게만 '누가 만들었는지' 를 보여줍니다.
           --    회원끼리 서로의 이메일을 보게 하면 안 됩니다.
           CASE WHEN is_admin() THEN p.email ELSE NULL END::text,
           (l.created_by = auth.uid())
    FROM public_links l
    LEFT JOIN profiles p ON p.id = l.created_by
    WHERE is_admin() OR l.created_by = auth.uid()
    ORDER BY l.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION my_share_links() TO authenticated;


-- ---------------------------------------------------------------------------
--  5. 확인 — 아래 4줄이 전부 ✅ 면 끝입니다
-- ---------------------------------------------------------------------------
SELECT * FROM (
    SELECT 1 AS "번호", '회원도 링크를 만들 수 있음' AS "확인 항목",
           CASE WHEN to_regprocedure('create_share_link(text,text,text,int)') IS NOT NULL
                 AND pg_get_functiondef(to_regprocedure('create_share_link(text,text,text,int)'))
                     LIKE '%v_admin%'
                THEN '✅' ELSE '❌ 이 파일을 다시 실행하세요' END AS "판정"
    UNION ALL
    SELECT 2, '한 사람당 개수·기한 제한이 있음',
           CASE WHEN to_regprocedure('share_limits()') IS NOT NULL
                THEN '✅ ' || (SELECT max_links || '개 · 최대 ' || max_hours || '시간'
                               FROM share_limits())
                ELSE '❌' END
    UNION ALL
    SELECT 3, '남의 링크는 못 끔',
           CASE WHEN pg_get_functiondef(to_regprocedure('set_share_link(text,boolean)'))
                     LIKE '%created_by = auth.uid()%'
                THEN '✅' ELSE '❌' END
    UNION ALL
    SELECT 4, 'public_links 표는 여전히 잠겨 있음',
           CASE WHEN NOT EXISTS (
               SELECT 1 FROM pg_policy p
               JOIN pg_class c ON c.oid = p.polrelid
               WHERE c.relname = 'public_links' AND p.polcmd = 'r'
           ) THEN '✅ 주소값은 함수로만 나갑니다' ELSE '❌ 표가 열려 있습니다' END
) x ORDER BY "번호";


-- ===========================================================================
--  되돌리기 — 다시 관리자 전용으로
-- ===========================================================================
--  아래 주석(--)을 지우고 이 부분만 실행하시면 됩니다.
--  그 다음 db/share.sql 을 한 번 더 실행하면 원래대로 돌아갑니다.
--
--  ※ 이미 만들어진 회원 링크는 그대로 살아 있습니다. 전부 끄시려면:
--
-- UPDATE public_links SET enabled = false
--  WHERE created_by <> (SELECT id FROM profiles WHERE role = 'admin' LIMIT 1);
-- ===========================================================================
