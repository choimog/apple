-- ===========================================================================
--  용량 기록표 — 매일 잰 결과를 하루 한 줄씩 남깁니다
-- ===========================================================================
--
--  【2026-08-18 대표님 요청】
--    "혹시 남은 저장용량을 사이트에 올려서 확인할 수 있나?
--     매칭 검토처럼 관리자 페이지에 말이지."
--
--  【왜 '재는 계산' 을 화면에 안 만들고 이 표를 두나요?】
--  crawler/capacity.py 맨 위에 이렇게 적혀 있습니다.
--
--      "원래 사이트 쪽 검사(web/scripts)에 있던 것을 옮겼습니다.
--       같은 계산을 두 군데 두면 반드시 어긋납니다. 한쪽만 고치게 되니까요."
--
--  **한 번 옮겨 온 계산입니다.** 2026-08-18 하루에만 그 계산을 두 번
--  고쳤습니다(도서 목록 증가분 반영 · 설정을 믿지 않도록 수정).
--  화면에 계산을 또 만들면 그 수정이 화면에는 안 들어갑니다.
--
--  그래서 **재는 일은 계속 capacity.py 한 곳**에서만 하고, 그 결과를
--  여기 한 줄씩 남깁니다. 화면은 **읽어서 보여주기만** 합니다.
--
--  【권한 — 왜 표로 두나요】
--  🚨 Supabase 함수 권한은 '회원' 단위로만 줄 수 있고 관리자만 따로
--     줄 수 없습니다. table_sizes() 를 회원에게 열면, 화면을 관리자로
--     막아도 **공개 열쇠로 직접 부르면 표 이름과 크기가 다 보입니다.**
--     표는 RLS 로 관리자만 읽게 막을 수 있어서 이 방법을 씁니다.
--
--  【용량】 하루 한 줄 약 100바이트 → 1년에 36KB. 사실상 0 입니다.
--
--  ▶ 이 파일은 **한 번만** 실행하시면 됩니다.
--  실행: Supabase → SQL Editor → New query → 전체 붙여넣고 Run (몇 초)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS capacity_log (
    -- 잰 날 (한국 날짜). 하루에 여러 번 재면 마지막 것으로 덮어씁니다.
    measured_on   date        PRIMARY KEY,

    -- 지금 쓰고 있는 양
    total_mb      real        NOT NULL,
    limit_mb      int         NOT NULL,

    -- 무엇이 얼마나 차지하나 (MB)
    daily_mb      real,       -- 순위 자료  (보관소로 빠져나감)
    catalog_mb    real,       -- 도서 목록  (정리 장치가 지움)
    slow_mb       real,       -- 수집 기록·리포트

    -- 하루에 얼마나 늘어나나 (MB/일)
    per_day       real,       -- 순위 자료
    catalog_day   real,       -- 도서 목록. NULL = 아직 못 쟀음
    slow_day      real,       -- 기록·리포트

    -- capacity.py 가 내린 판단
    steady_mb     real,       -- 도달점 (여기서 멈춥니다)
    days_left     int,        -- 999 = 한도에 닿지 않음
    stale_prune   boolean     NOT NULL DEFAULT false,
    problem       text,       -- 문제가 있으면 그 문장, 없으면 NULL

    measured_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE capacity_log IS
    '매일 수집 뒤 crawler/capacity.py 가 남기는 용량 기록. 화면은 읽기만 합니다.';


-- ---------------------------------------------------------------------------
--  🚨 관리자만 읽습니다
-- ---------------------------------------------------------------------------
--  표 크기는 방문자가 알 이유가 없습니다. 일반 회원도 마찬가지입니다.
--  RLS 를 켜면 공개 열쇠로 직접 불러도 빈 결과가 돌아옵니다.
--
--  ⚠️ 쓰기는 아무에게도 안 엽니다. GitHub 작업(관리자 열쇠)만 씁니다.
--     관리자 열쇠는 RLS 를 지나갑니다.
-- ---------------------------------------------------------------------------
ALTER TABLE capacity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "관리자만 용량 보기" ON capacity_log;
CREATE POLICY "관리자만 용량 보기" ON capacity_log
    FOR SELECT TO authenticated
    USING (is_admin());

GRANT SELECT ON capacity_log TO authenticated;

-- 🚨 회원에게는 쓰기를 주지 않습니다. INSERT·UPDATE·DELETE 없음.


-- ---------------------------------------------------------------------------
--  확인
-- ---------------------------------------------------------------------------
SELECT "항목", "값" FROM (
    SELECT 1 AS ord, '표가 만들어졌다' AS "항목",
           CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
                              WHERE table_schema = 'public'
                                AND table_name = 'capacity_log')
                THEN '✅ 예' ELSE '❌ 아니오' END AS "값"
    UNION ALL
    SELECT 2, '관리자만 읽도록 막혔다',
           CASE WHEN EXISTS (SELECT 1 FROM pg_policies
                              WHERE schemaname = 'public'
                                AND tablename = 'capacity_log'
                                AND policyname = '관리자만 용량 보기')
                THEN '✅ 예' ELSE '❌ 아니오' END
    UNION ALL
    SELECT 3, '회원에게 쓰기를 안 열었다',
           CASE WHEN NOT EXISTS (
                    SELECT 1 FROM information_schema.role_table_grants
                     WHERE table_schema = 'public'
                       AND table_name = 'capacity_log'
                       AND grantee = 'authenticated'
                       AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE'))
                THEN '✅ 예' ELSE '❌ 아니오 — 알려 주세요' END
    UNION ALL
    SELECT 4, '지금 쌓인 기록',
           coalesce((SELECT count(*)::text FROM capacity_log), '0')
           || '일치 (다음 [매일 수집] 부터 쌓입니다)'
) x ORDER BY ord;
