-- ===========================================================================
--  '내가 내린 결정' 8만 5천 건이 어디서 왔는지 — 읽기만 합니다
-- ===========================================================================
--  【왜 보나요? — 2026-08-11 대표님 말씀】
--  "나는 매칭검토에서 현재 결정한 건이 없어. 전부 다 되돌려놓은 상태야."
--
--  그런데 데이터베이스에는 이렇게 들어 있습니다.
--      manual_split  47,054줄
--      manual_merge  38,161줄
--                    ─────────
--                    85,215줄
--
--  둘 중 하나가 사실이 아닙니다. 짐작으로 넘기면 안 되는 자리입니다.
--    · 이 줄들이 진짜라면 → 지금 매칭이 이 결정에 묶여 돌고 있습니다.
--      특히 manual_split 47,054건은 **영구 블랙리스트**라, 합쳐져야 할
--      짝이 영원히 안 합쳐집니다.
--    · 대표님이 되돌리셨는데 안 지워진 것이라면 → 되돌리기가 고장난
--      것이고, 대표님은 고쳐진 줄 알고 계신 것입니다.
--
--  【제가 코드에서 찾은 유력한 원인】
--  '되돌리기' 는 auto_decision(원래 자동 판단이 뭐였는지)을 보고
--  그 값으로 되돌립니다. 그 값이 비어 있으면 **되돌리기를 거부합니다.**
--  아무 값이나 넣어 '되돌린 척' 하지 않으려고 그렇게 만들었습니다.
--
--  그런데 auto_decision 칸은 나중에 추가됐고, 채워 넣을 때
--  db/auth.sql 이 이렇게 적혀 있습니다.
--
--      WHERE decision IN ('auto_high', 'auto_low', 'rejected')
--
--  **사람이 이미 결정한 줄은 일부러 건너뛴 것입니다.**
--  그래서 그 전에 내리신 결정들은 auto_decision 이 비어 있고,
--  지금은 되돌리려 해도 조용히 거부됩니다.
--  (엑셀로 올리면 '되돌릴 수 없음' 숫자에만 잡히고 넘어갑니다)
--
--  ⑥번 줄이 그 답입니다. 거기가 크면 제 짐작이 맞습니다.
--
--  【안전한가요?】
--  네. 세기만 합니다. 만들지도, 고치지도, 지우지도 않습니다.
--
--  실행: Supabase → SQL Editor → New query → 전체 붙여넣고 Run
--        표 하나가 나옵니다. 그대로 알려 주세요.
-- ===========================================================================

WITH m AS (
    SELECT * FROM book_matches
     WHERE decision IN ('manual_merge', 'manual_split')
),
byday AS (
    SELECT (decided_at AT TIME ZONE 'Asia/Seoul')::date AS d, count(*) AS n
      FROM m WHERE decided_at IS NOT NULL
     GROUP BY 1 ORDER BY n DESC LIMIT 5
)

SELECT "번호", "항목", "값", "뜻" FROM (

    SELECT 1 AS "번호", '같은 책 (manual_merge)' AS "항목",
           to_char((SELECT count(*) FROM m WHERE decision = 'manual_merge'),
                   'FM999,999,999') AS "값",
           '' AS "뜻"

    UNION ALL
    SELECT 2, '다른 책 (manual_split)',
           to_char((SELECT count(*) FROM m WHERE decision = 'manual_split'),
                   'FM999,999,999'),
           '🚨 영구 블랙리스트. 이만큼이 영원히 안 합쳐집니다'

    UNION ALL
    -- 화면이나 엑셀로 누르면 '누가 눌렀는지' 가 반드시 남습니다.
    -- 비어 있으면 사람이 누른 게 아니거나, 되돌리다 만 것입니다.
    SELECT 3, '  └ 누가 눌렀는지 남아 있는 것',
           to_char((SELECT count(*) FROM m WHERE decided_by IS NOT NULL),
                   'FM999,999,999'),
           '사람이 화면·엑셀로 누른 흔적'

    UNION ALL
    SELECT 4, '  └ 누른 사람이 비어 있는 것',
           to_char((SELECT count(*) FROM m WHERE decided_by IS NULL),
                   'FM999,999,999'),
           '⚠️ 있으면 사람이 누른 게 아닙니다'

    UNION ALL
    SELECT 5, '누른 사람 수',
           to_char((SELECT count(DISTINCT decided_by) FROM m
                     WHERE decided_by IS NOT NULL), 'FM999,999'),
           ''

    UNION ALL
    -- ★ 여기가 핵심입니다
    SELECT 6, '★ 되돌릴 수 없는 결정',
           to_char((SELECT count(*) FROM m WHERE auto_decision IS NULL),
                   'FM999,999,999'),
           '원래 자동 판단이 안 남아 있어 되돌리기가 거부됩니다'

    UNION ALL
    SELECT 7, '  └ 되돌릴 수 있는 결정',
           to_char((SELECT count(*) FROM m WHERE auto_decision IS NOT NULL),
                   'FM999,999,999'),
           '지금도 되돌리기 버튼이 먹습니다'

    UNION ALL
    SELECT 8, '가장 먼저 누른 때',
           coalesce((SELECT to_char(min(decided_at) AT TIME ZONE 'Asia/Seoul',
                                    'YYYY-MM-DD HH24:MI') FROM m),
                    '(기록 없음)'),
           '한국시간'

    UNION ALL
    SELECT 9, '가장 나중에 누른 때',
           coalesce((SELECT to_char(max(decided_at) AT TIME ZONE 'Asia/Seoul',
                                    'YYYY-MM-DD HH24:MI') FROM m),
                    '(기록 없음)'),
           '한국시간'

    UNION ALL
    SELECT 10, '누른 때가 아예 없는 줄',
           to_char((SELECT count(*) FROM m WHERE decided_at IS NULL),
                   'FM999,999,999'),
           '⚠️ 있으면 되돌리다 만 흔적일 수 있습니다'

    UNION ALL
    SELECT 10 + row_number() OVER (ORDER BY n DESC),
           '  · ' || d::text || ' 에 누른 것',
           to_char(n, 'FM999,999,999'),
           '많이 누른 날 상위 5일'
      FROM byday

) x ORDER BY "번호";
