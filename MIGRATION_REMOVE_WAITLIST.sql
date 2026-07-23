-- ============================================================================
-- 菇菇宅配網 — 備取取消 + 缺席停權改制
-- 執行日期：2026-07-21
-- 
-- 變更摘要：
-- 1. signup_for_challenge — 移除備取(slots+2)，改為 slots 直接額滿拒絕
--                        缺席懲罰從 (daily_count+absent_score)>=limit 改為 absent_score>=3 停權
-- 2. cancel_signup_and_update_challenge — 簡化為無備取版本，所有正取取消都退還額度
-- 
-- 復原方式：本檔案底部有原始版本的備份 SQL
-- ============================================================================

-- ============================================================================
-- 防呆：先刪除可能因歷史原因殘留的不同簽名版本
-- ============================================================================
DROP FUNCTION IF EXISTS public.signup_for_challenge(integer);
DROP FUNCTION IF EXISTS public.signup_for_challenge(bigint);
DROP FUNCTION IF EXISTS public.cancel_signup_and_update_challenge(integer);
DROP FUNCTION IF EXISTS public.cancel_signup_and_update_challenge(bigint);

-- ============================================================================
-- 第一步：signup_for_challenge 改寫
-- ============================================================================

CREATE OR REPLACE FUNCTION public.signup_for_challenge(challenge_id_to_signup bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    target_challenge RECORD;
    current_count INT;
    user_signup_count INT;
    user_absent_score INT;
    current_limit INT;
    signup_time timestamptz;
    calculated_speed numeric;
    user_id_from_auth UUID;
BEGIN
    user_id_from_auth := auth.uid();
    signup_time := now();

    IF user_id_from_auth IS NULL THEN
        RAISE EXCEPTION '請先登入';
    END IF;

    -- 檢查重複報名
    IF EXISTS (SELECT 1 FROM public.signups WHERE user_id = user_id_from_auth AND challenge_id = challenge_id_to_signup) THEN
        RAISE EXCEPTION 'You have already signed up';
    END IF;

    -- 鎖定挑戰
    SELECT * INTO target_challenge FROM public.challenges WHERE id = challenge_id_to_signup FOR UPDATE;
    IF target_challenge IS NULL THEN RAISE EXCEPTION 'Challenge not found'; END IF;
    
    -- 狀態檢查（移除已額滿的放行，因為不再有候補）
    IF target_challenge.status != '開放報名中' AND target_challenge.status != '預計開放' THEN 
        RAISE EXCEPTION 'Challenge is closed'; 
    END IF;
    
    -- 時間檢查
    IF signup_time < target_challenge.start_time THEN RAISE EXCEPTION '報名尚未開始'; END IF;

    -- 人數檢查：達 slots 即拒絕（不再有 slots+2 候補）
    SELECT count(*) INTO current_count FROM public.signups WHERE challenge_id = challenge_id_to_signup;
    IF current_count >= target_challenge.slots THEN
        UPDATE public.challenges SET status = '已額滿' WHERE id = challenge_id_to_signup AND status != '已額滿';
        RAISE EXCEPTION 'Challenge is full';
    END IF;

    -- === 缺席停權檢查（新制：>= 3 即停權） ===
    SELECT COALESCE(absent_score, 0) INTO user_absent_score
    FROM public.profiles WHERE id = user_id_from_auth;

    IF user_absent_score >= 3 THEN
        RAISE EXCEPTION '您因累積缺席 % 次，已被暫時停權，請等待每日自動恢復（每日 -1）。', user_absent_score;
    END IF;

    -- === 每日額度檢查 ===
    IF target_challenge.is_guest IS TRUE THEN
        -- 訪客菇不扣額度
        NULL;
    ELSE
        SELECT setting_value INTO current_limit FROM public.daily_settings WHERE setting_name = 'daily_signup_limit';
        IF current_limit IS NULL THEN current_limit := 3; END IF;

        SELECT daily_signup_count INTO user_signup_count
        FROM public.profiles WHERE id = user_id_from_auth;
        IF user_signup_count IS NULL THEN user_signup_count := 0; END IF;

        IF user_signup_count >= current_limit THEN
            RAISE EXCEPTION '本日報名次數已達上限 (%)', current_limit;
        END IF;
    END IF;

    -- === 執行報名 ===
    calculated_speed := EXTRACT(EPOCH FROM (signup_time - target_challenge.start_time));

    INSERT INTO public.signups (user_id, challenge_id, signup_speed, signed_up_at)
    VALUES (user_id_from_auth, challenge_id_to_signup, calculated_speed, signup_time);

    -- 更新 profiles 統計
    UPDATE public.profiles
    SET
        daily_signup_count = CASE WHEN target_challenge.is_guest IS TRUE THEN daily_signup_count ELSE daily_signup_count + 1 END,
        weekly_signup_count = weekly_signup_count + 1,
        monthly_signup_count = monthly_signup_count + 1,
        weekly_fastest_time = LEAST(COALESCE(weekly_fastest_time, 999999), calculated_speed),
        monthly_fastest_time = LEAST(COALESCE(monthly_fastest_time, 999999), calculated_speed),
        last_active_at = now()
    WHERE id = user_id_from_auth;

    -- 額滿時更新挑戰狀態
    IF (current_count + 1) >= target_challenge.slots THEN
        UPDATE public.challenges SET status = '已額滿' WHERE id = challenge_id_to_signup AND status != '已額滿';
    END IF;
END;
$$;


-- ============================================================================
-- 第二步：cancel_signup_and_update_challenge 改寫
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cancel_signup_and_update_challenge(challenge_id_to_cancel bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    user_id_to_check UUID := auth.uid();
    target_challenge RECORD;
    canceled_speed numeric;
    current_weekly_fastest numeric;
    current_monthly_fastest numeric;
    new_weekly_fastest numeric;
    new_monthly_fastest numeric;
    current_count INT;
BEGIN
    -- 鎖定挑戰
    SELECT * INTO target_challenge
    FROM challenges
    WHERE id = challenge_id_to_cancel
    FOR UPDATE;

    IF target_challenge IS NULL THEN
        RAISE EXCEPTION 'Challenge not found';
    END IF;

    -- 取得報名資訊
    SELECT s.signup_speed, p.weekly_fastest_time, p.monthly_fastest_time
    INTO canceled_speed, current_weekly_fastest, current_monthly_fastest 
    FROM public.signups s
    JOIN public.profiles p ON s.user_id = p.id
    WHERE s.user_id = user_id_to_check AND s.challenge_id = challenge_id_to_cancel;

    IF NOT FOUND THEN
        RAISE EXCEPTION '找不到您的報名紀錄';
    END IF;

    -- 執行刪除（trigger 會自動備份到 signup_history）
    DELETE FROM public.signups
    WHERE user_id = user_id_to_check AND challenge_id = challenge_id_to_cancel;

    -- 退還報名額度（訪客菇不退）
    UPDATE public.profiles
    SET
        daily_signup_count = CASE WHEN target_challenge.is_guest IS TRUE 
            THEN daily_signup_count 
            ELSE GREATEST(0, daily_signup_count - 1) 
        END,
        weekly_signup_count = GREATEST(0, weekly_signup_count - 1),
        monthly_signup_count = GREATEST(0, monthly_signup_count - 1)
    WHERE id = user_id_to_check;

    -- 重新檢查最速紀錄
    IF canceled_speed IS NOT NULL THEN
        IF canceled_speed = current_weekly_fastest THEN
            SELECT MIN(signup_speed) INTO new_weekly_fastest
            FROM public.signup_history 
            WHERE user_id = user_id_to_check AND signed_up_at >= date_trunc('week', now());
            UPDATE public.profiles SET weekly_fastest_time = new_weekly_fastest WHERE id = user_id_to_check;
        END IF;

        IF canceled_speed = current_monthly_fastest THEN
            SELECT MIN(signup_speed) INTO new_monthly_fastest
            FROM public.signup_history
            WHERE user_id = user_id_to_check AND signed_up_at >= date_trunc('month', now());
            UPDATE public.profiles SET monthly_fastest_time = new_monthly_fastest WHERE id = user_id_to_check;
        END IF;
    END IF;

    -- 更新挑戰狀態
    SELECT count(*) INTO current_count FROM signups WHERE challenge_id = challenge_id_to_cancel;

    IF current_count >= target_challenge.slots THEN
        UPDATE challenges SET status = '已額滿' WHERE id = challenge_id_to_cancel AND status != '已額滿';
    ELSIF now() < target_challenge.start_time THEN
        UPDATE challenges SET status = '預計開放' WHERE id = challenge_id_to_cancel;
    ELSE
        UPDATE challenges SET status = '開放報名中' WHERE id = challenge_id_to_cancel;
    END IF;
END;
$$;


-- ============================================================================
-- 復原用：原始版本 SQL（出問題時，複製以下內容到 SQL Editor 執行即可還原）
-- ============================================================================

-- ---- 復原 signup_for_challenge 原始版本 ----
-- CREATE OR REPLACE FUNCTION public.signup_for_challenge(challenge_id_to_signup bigint)
-- RETURNS void
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- AS $$
-- DECLARE
--     target_challenge RECORD;
--     current_count INT; 
--     user_signup_count INT;
--     user_absent_score INT;
--     current_limit INT;
--     increment_daily_value INT;
--     signup_time timestamptz;
--     calculated_speed numeric;
--     user_id_from_auth UUID;
--     is_waitlist BOOLEAN;
-- BEGIN
--     user_id_from_auth := auth.uid();
--     signup_time := now();
--     IF user_id_from_auth IS NULL THEN RAISE EXCEPTION '請先登入'; END IF;
--     IF EXISTS (SELECT 1 FROM public.signups WHERE user_id = user_id_from_auth AND challenge_id = challenge_id_to_signup) THEN
--         RAISE EXCEPTION 'You have already signed up';
--     END IF;
--     SELECT * INTO target_challenge FROM public.challenges WHERE id = challenge_id_to_signup FOR UPDATE;
--     IF target_challenge IS NULL THEN RAISE EXCEPTION 'Challenge not found'; END IF;
--     IF target_challenge.status != '開放報名中' AND target_challenge.status != '預計開放' AND target_challenge.status != '已額滿' THEN 
--         RAISE EXCEPTION 'Challenge is closed'; 
--     END IF;
--     IF signup_time < target_challenge.start_time THEN RAISE EXCEPTION '報名尚未開始'; END IF;
--     SELECT count(*) INTO current_count FROM public.signups WHERE challenge_id = challenge_id_to_signup;
--     is_waitlist := current_count >= target_challenge.slots;
--     IF current_count >= (target_challenge.slots + 2) THEN
--         UPDATE public.challenges SET status = '已額滿' WHERE id = challenge_id_to_signup AND status != '已額滿';
--         RAISE EXCEPTION 'Challenge is full (Waitlist full)';
--     END IF;
--     IF target_challenge.is_guest IS TRUE OR is_waitlist IS TRUE THEN
--         increment_daily_value := 0;
--     ELSE
--         increment_daily_value := 1;
--         SELECT setting_value INTO current_limit FROM public.daily_settings WHERE setting_name = 'daily_signup_limit';
--         IF current_limit IS NULL THEN current_limit := 3; END IF;
--         SELECT daily_signup_count, COALESCE(absent_score, 0)
--         INTO user_signup_count, user_absent_score
--         FROM public.profiles WHERE id = user_id_from_auth;
--         IF user_signup_count IS NULL THEN user_signup_count := 0; END IF;
--         IF (user_signup_count + user_absent_score) >= current_limit THEN
--             RAISE EXCEPTION '您近期因報名後缺席(累積💤%)，已被暫時限制報名，請耐心等待每日恢復。', user_absent_score;
--         END IF;
--     END IF;
--     calculated_speed := EXTRACT(EPOCH FROM (signup_time - target_challenge.start_time));
--     INSERT INTO public.signups (user_id, challenge_id, signup_speed, signed_up_at)
--     VALUES (user_id_from_auth, challenge_id_to_signup, calculated_speed, signup_time);
--     UPDATE public.profiles
--     SET
--         daily_signup_count = daily_signup_count + increment_daily_value,
--         weekly_signup_count = weekly_signup_count + 1,
--         monthly_signup_count = monthly_signup_count + 1,
--         weekly_fastest_time = LEAST(COALESCE(weekly_fastest_time, 999999), calculated_speed),
--         monthly_fastest_time = LEAST(COALESCE(monthly_fastest_time, 999999), calculated_speed),
--         last_active_at = now()
--     WHERE id = user_id_from_auth;
--     IF (current_count + 1) >= target_challenge.slots THEN
--         UPDATE public.challenges SET status = '已額滿' WHERE id = challenge_id_to_signup AND status != '已額滿';
--     END IF;
-- END;
-- $$;

-- ---- 復原 cancel_signup_and_update_challenge 原始版本 ----
-- CREATE OR REPLACE FUNCTION public.cancel_signup_and_update_challenge(challenge_id_to_cancel bigint)
-- RETURNS void
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- AS $$
-- DECLARE
--     user_id_to_check UUID := auth.uid();
--     target_challenge RECORD;
--     my_signup_time timestamptz;
--     my_rank INT;
--     daily_decrement_value INT;
--     canceled_speed numeric;
--     current_weekly_fastest numeric;
--     current_monthly_fastest numeric;
--     new_weekly_fastest numeric;
--     new_monthly_fastest numeric;
--     current_count INT;
-- BEGIN
--     SELECT * INTO target_challenge FROM challenges WHERE id = challenge_id_to_cancel FOR UPDATE;
--     IF target_challenge IS NULL THEN RAISE EXCEPTION 'Challenge not found'; END IF;
--     SELECT s.signup_speed, s.signed_up_at, p.weekly_fastest_time, p.monthly_fastest_time
--     INTO canceled_speed, my_signup_time, current_weekly_fastest, current_monthly_fastest 
--     FROM public.signups s JOIN public.profiles p ON s.user_id = p.id
--     WHERE s.user_id = user_id_to_check AND s.challenge_id = challenge_id_to_cancel;
--     IF NOT FOUND THEN RAISE EXCEPTION '找不到您的報名紀錄'; END IF;
--     SELECT count(*) INTO my_rank FROM signups
--     WHERE challenge_id = challenge_id_to_cancel AND signed_up_at <= my_signup_time;
--     IF my_rank > target_challenge.slots THEN
--         daily_decrement_value := 0;
--     ELSE
--         IF target_challenge.is_guest IS TRUE THEN
--             daily_decrement_value := 0;
--         ELSE
--             daily_decrement_value := 1;
--         END IF;
--     END IF;
--     DELETE FROM public.signups WHERE user_id = user_id_to_check AND challenge_id = challenge_id_to_cancel;
--     IF FOUND THEN
--         UPDATE public.profiles SET
--             daily_signup_count = greatest(0, daily_signup_count - daily_decrement_value),
--             weekly_signup_count = greatest(0, weekly_signup_count - 1),
--             monthly_signup_count = greatest(0, monthly_signup_count - 1)
--         WHERE id = user_id_to_check;
--         IF canceled_speed IS NOT NULL THEN
--             IF canceled_speed = current_weekly_fastest THEN
--                 SELECT MIN(signup_speed) INTO new_weekly_fastest FROM public.signup_history 
--                 WHERE user_id = user_id_to_check AND signed_up_at >= date_trunc('week', now());
--                 UPDATE public.profiles SET weekly_fastest_time = new_weekly_fastest WHERE id = user_id_to_check;
--             END IF;
--             IF canceled_speed = current_monthly_fastest THEN
--                 SELECT MIN(signup_speed) INTO new_monthly_fastest FROM public.signup_history
--                 WHERE user_id = user_id_to_check AND signed_up_at >= date_trunc('month', now());
--                 UPDATE public.profiles SET monthly_fastest_time = new_monthly_fastest WHERE id = user_id_to_check;
--             END IF;
--         END IF;
--         SELECT count(*) INTO current_count FROM signups WHERE challenge_id = challenge_id_to_cancel;
--         IF current_count >= target_challenge.slots THEN
--             UPDATE challenges SET status = '已額滿' WHERE id = challenge_id_to_cancel AND status != '已額滿';
--         ELSIF now() < target_challenge.start_time THEN
--             UPDATE challenges SET status = '預計開放' WHERE id = challenge_id_to_cancel;
--         ELSE
--             UPDATE challenges SET status = '開放報名中' WHERE id = challenge_id_to_cancel;
--         END IF;
--     END IF;
-- END;
-- $$;
