-- ===========================================================================
--  공유 링크가 왜 안 되는지 알아보기 — 자료를 하나도 바꾸지 않습니다
-- ===========================================================================
--  【언제 쓰나요?】
--  공유 링크 화면에 "아직 준비가 안 됐습니다" 가 뜰 때,
--  **무엇이 문제인지 짐작하지 않고 확인하려고** 씁니다.
--
--  【안전한가요?】
--  네. 읽기만 합니다. 표를 만들지도, 고치지도, 지우지도 않습니다.
--
--  실행: Supabase → SQL Editor → New query → 이 파일 전체 붙여넣고 Run
--        나온 표를 그대로 알려 주시면 됩니다.
-- ===========================================================================

SELECT * FROM (

    -- (1) 링크 목록 함수가 '회원 개방판' 인가, '관리자 전용판' 인가
    --     새 판에는 owner_email 칸이 있습니다. 없으면 옛 판입니다.
    SELECT 1 AS "번호",
           '링크 목록 함수' AS "무엇을 봤나",
           CASE
             WHEN to_regprocedure('my_share_links()') IS NULL
               THEN '❌ 없음 — db/share.sql 부터 실행하세요'
             WHEN pg_get_function_result(to_regprocedure('my_share_links()'))
                  LIKE '%owner_email%'
               THEN '✅ 회원 개방판 (share-open.sql 이 들어가 있음)'
             ELSE '❌ 관리자 전용판 — db/share-open.sql 을 실행하세요'
           END AS "결과"

    UNION ALL
    -- (2) 링크 만들기 함수도 회원 개방판인가
    SELECT 2, '링크 만들기 함수',
           CASE
             WHEN to_regprocedure('create_share_link(text,text,text,int)') IS NULL
               THEN '❌ 없음 — db/share.sql 부터 실행하세요'
             WHEN pg_get_functiondef(
                    to_regprocedure('create_share_link(text,text,text,int)')
                  ) LIKE '%v_admin%'
               THEN '✅ 회원 개방판'
             ELSE '❌ 관리자 전용판 — db/share-open.sql 을 실행하세요'
           END

    UNION ALL
    -- (3) 개수·시간 제한이 들어가 있나
    SELECT 3, '회원 제한 (개수·시간)',
           CASE WHEN to_regprocedure('share_limits()') IS NULL
                THEN '❌ 없음 — db/share-open.sql 을 실행하세요'
                ELSE '✅ ' || (SELECT max_links || '개 · 최대 ' || max_hours || '시간'
                               FROM share_limits())
           END

    UNION ALL
    -- (4) 🚨 관리자로 지정된 계정이 있나
    --     "관리자만 볼 수 있습니다" 가 뜨는 가장 흔한 다른 이유입니다.
    --     로그인은 됐는데 그 계정의 권한이 'viewer' 인 경우입니다.
    SELECT 4, '관리자 계정',
           CASE WHEN EXISTS (SELECT 1 FROM profiles WHERE role = 'admin')
                THEN '✅ ' || (SELECT count(*)::text FROM profiles WHERE role = 'admin')
                     || '명: ' || (SELECT string_agg(email, ', ')
                                   FROM profiles WHERE role = 'admin')
                ELSE '❌ 한 명도 없습니다 — 아래 (6)번을 보세요'
           END

    UNION ALL
    -- (5) 지금 있는 링크 수 (자료를 바꾸지 않고 세기만 합니다)
    SELECT 5, '지금 살아 있는 링크',
           (SELECT count(*)::text || '개' FROM public_links
             WHERE enabled AND (expires_at IS NULL OR expires_at > now()))

) x ORDER BY "번호";


-- ---------------------------------------------------------------------------
--  (6) 전체 회원과 권한 — 내 계정이 admin 인지 눈으로 확인하세요
-- ---------------------------------------------------------------------------
SELECT email AS "이메일",
       role  AS "권한",
       CASE WHEN role = 'admin' THEN '✅ 관리자' ELSE '보기 전용' END AS "설명"
FROM profiles
ORDER BY role, email;


-- ===========================================================================
--  내 계정이 '보기 전용' 으로 나왔다면 — 아래 한 줄의 주석(--)을 지우고
--  이메일만 바꿔서 실행하시면 관리자가 됩니다.
-- ===========================================================================
-- UPDATE profiles SET role = 'admin' WHERE email = '여기에@이메일.넣기';
