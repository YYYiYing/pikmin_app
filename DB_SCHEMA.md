# 菇菇宅配網 — 資料庫 Schema 完整參考

> 來源：使用者提供的 DDL SQL + RPC/Trigger 原始碼匯出
> 最後更新：2026-07-21

---

## 一、自訂 Enum 類型

### `public.challenge_status`
| 值 | 用途 | 寫入者 |
|----|------|--------|
| `預計開放` | start_time 未到，等待開放 | Edge Function, RPC |
| `開放報名中` | 已開放，人數未滿 | Edge Function, RPC `open_due_challenges` |
| `已額滿` | 人數達 slots（含備取 slots+2） | RPC `signup_for_challenge`, Edge Function |
| `已配達` | ⚠️ 定義存在但**從未被程式碼寫入**，可能為歷史遺留 | — |

### `public.user_role`
| 值 | 用途 |
|----|------|
| `報名者` | 基本角色 |
| `發菇者` | 可發布挑戰 |
| `發菇及報名者` | 可發布 + 可報名 |
| `管理者` | 最高權限 |

---

## 二、資料表總覽 (18 張)

| # | 資料表 | 用途 | 主要存取方式 |
|---|--------|------|-------------|
| 1 | `absent_records` | 缺席記錄 | RPC |
| 2 | `challenges` | 蘑菇挑戰 | 前端 SELECT + RPC + Edge Function |
| 3 | `daily_settings` | 系統設定 | Edge Function, admin |
| 4 | `guest_fly_posts` | 訪客自飛菇 | Edge Function |
| 5 | `guest_messages` | 訪客留言 | 前端 Realtime + Edge Function |
| 6 | `guest_postcard_likes` | 訪客美片按讚 | Edge Function |
| 7 | `guest_postcards` | 訪客美片(藝廊) | Edge Function |
| 8 | `partners` | 好友碼名冊 | Edge Function (同步) |
| 9 | `postcard_likes` | 會員美片按讚 | Edge Function |
| 10 | `postcards` | 會員美片(圖書館) | 前端 SELECT + Edge Function |
| 11 | `profiles` | 使用者檔案 | 全頁面 + RPC + Edge Function |
| 12 | `radar_categories` | 雷達分類 | Edge Function |
| 13 | `radar_posts` | 雷達地點 | Edge Function |
| 14 | `radar_votes` | 雷達投票 | Edge Function |
| 15 | `signup_history` | 簽到歷史歸檔 | Trigger 自動 |
| 16 | `signups` | 報名記錄 | RPC + Edge Function + Realtime |
| 17 | `user_alts` | 使用者分身 | 前端直接讀寫 |
| 18 | `wish_stats` | 許願統計 | 前端 SELECT + RPC |

---

## 三、各資料表欄位定義

### 1. absent_records
| 欄位 | 型別 | 約束 |
|------|------|------|
| `id` | bigint | PK |
| `challenge_id` | bigint | FK → challenges.id ON DELETE CASCADE |
| `reporter_id` | uuid | FK → profiles.id |
| `absentee_id` | uuid | FK → profiles.id |
| `created_at` | timestamptz | DEFAULT now() |

UNIQUE (challenge_id, absentee_id)

### 2. challenges
| 欄位 | 型別 | 約束 |
|------|------|------|
| `id` | bigint | PK |
| `host_id` | uuid | FK → profiles.id ON DELETE CASCADE |
| `mushroom_type` | text | NOT NULL |
| `start_time` | timestamptz | NOT NULL |
| `slots` | smallint | NOT NULL |
| `status` | challenge_status enum | NOT NULL |
| `details` | text | 用餐時段 |
| `dispatch_status` | text | DEFAULT '待發' |
| `dispatched_at` | timestamptz | |
| `cooking_style` | text | |
| `image_url` | text | |
| `countdown_end_time` | timestamptz | 校時用 |
| `display_host_name` | text | 分身/訪客顯示名 |
| `notes` | text | |
| `is_guest` | boolean | DEFAULT false |
| `guest_ip` | text | |
| `current_players` | integer | DEFAULT 0 ⚠️ 程式碼未使用 |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |

### 3. daily_settings
| 欄位 | 型別 | 約束 |
|------|------|------|
| `id` | bigint | PK |
| `setting_name` | text | NOT NULL UNIQUE |
| `setting_value` | integer | NOT NULL DEFAULT 0 |
| `setting_text` | text | |
| `updated_at` | timestamptz | DEFAULT now() |

### 4. guest_fly_posts
| 欄位 | 型別 | 約束 |
|------|------|------|
| `id` | bigint | PK |
| `nickname` | text | NOT NULL |
| `friend_code` | text | NOT NULL |
| `slots` | integer | NOT NULL DEFAULT 1 |
| `coordinates` | text | NOT NULL |
| `mushroom_type` | text | |
| `cooking_style` | text | |
| `notes` | text | |
| `image_url` | text | |
| `guest_ip` | text | |
| `status` | text | DEFAULT '開放報名中' ⚠️ 程式碼未讀取此欄位 |
| `created_at` | timestamptz | NOT NULL |

### 5. guest_messages
| 欄位 | 型別 | 約束 |
|------|------|------|
| `id` | bigint | PK |
| `nickname` | text | NOT NULL |
| `message` | text | NOT NULL |
| `ip_fingerprint` | text | SHA-1 前 6 碼 |
| `created_at` | timestamptz | NOT NULL |

### 6. guest_postcard_likes
| 欄位 | 型別 | 約束 |
|------|------|------|
| `id` | bigint | PK |
| `postcard_id` | bigint | FK → guest_postcards.id ON DELETE CASCADE |
| `ip_fingerprint` | text | |
| `created_at` | timestamptz | DEFAULT now() |

UNIQUE (postcard_id, ip_fingerprint)

### 7. guest_postcards
| 欄位 | 型別 | 約束 |
|------|------|------|
| `id` | bigint | PK |
| `nickname` | text | NOT NULL |
| `friend_code` | text | |
| `ip_fingerprint` | text | `'system_import'` = 從圖書館遷入 |
| `coordinate` | text | |
| `image_url` | text | |
| `tags` | text[] | |
| `country` | text | |
| `region` | text | |
| `area` | text | |
| `likes` | integer | DEFAULT 0 |
| `is_obsolete` | boolean | DEFAULT false |
| `created_at` | timestamptz | DEFAULT now() |

### 8. partners
| 欄位 | 型別 | 約束 |
|------|------|------|
| `id` | bigint | PK |
| `name` | text | NOT NULL |
| `friend_code` | text | NOT NULL |
| `user_id` | uuid | FK → profiles.id |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |

### 9. postcard_likes
| 欄位 | 型別 | 約束 |
|------|------|------|
| `id` | bigint | PK |
| `postcard_id` | bigint | NOT NULL, FK → postcards.id ON DELETE CASCADE |
| `user_id` | uuid | FK → auth.users.id ON DELETE CASCADE |
| `guest_id` | text | ⚠️ 重複設計，Edge Function 未使用 |
| `created_at` | timestamptz | DEFAULT now() |

### 10. postcards
| 欄位 | 型別 | 約束 |
|------|------|------|
| `id` | bigint | PK |
| `uploader_id` | uuid | FK → auth.users.id ON DELETE SET NULL |
| `uploader_nickname` | text | NOT NULL DEFAULT '匿名訪客' |
| `coordinate` | text | |
| `image_url` | text | NOT NULL |
| `tags` | text[] | |
| `country` | text | DEFAULT '' |
| `region` | text | DEFAULT '' |
| `area` | text | DEFAULT '' |
| `likes` | integer | DEFAULT 0 |
| `is_obsolete` | boolean | DEFAULT false |
| `created_at` | timestamptz | DEFAULT now() |

### 11. profiles
| 欄位 | 型別 | 約束 |
|------|------|------|
| `id` | uuid | PK, FK → auth.users.id ON DELETE CASCADE |
| `nickname` | text | NOT NULL UNIQUE |
| `role` | user_role enum | NOT NULL |
| `claimed_at` | timestamptz | ⚠️ 程式碼未使用 |
| `daily_signup_count` | smallint | NOT NULL DEFAULT 0 |
| `last_reset_date` | date | 每日重置基準日 |
| `weekly_signup_count` | integer | NOT NULL DEFAULT 0 |
| `monthly_signup_count` | integer | NOT NULL DEFAULT 0 |
| `weekly_fastest_time` | numeric(10,3) | 最快報名秒數 |
| `monthly_fastest_time` | numeric(10,3) | 最快報名秒數 |
| `last_active_at` | timestamptz | 最後上線 |
| `weekly_host_count` | integer | DEFAULT 0 |
| `monthly_host_count` | integer | DEFAULT 0 |
| `daily_wish_count` | integer | DEFAULT 0 |
| `weekly_postcard_count` | integer | DEFAULT 0 |
| `monthly_postcard_count` | integer | DEFAULT 0 |
| `is_subscribed_signup` | boolean | DEFAULT false |
| `is_subscribed_full` | boolean | DEFAULT false |
| `absent_score` | integer | DEFAULT 0 |
| `notes` | text | DEFAULT '' |

### 12. radar_categories
| 欄位 | 型別 | 約束 |
|------|------|------|
| `id` | bigint | PK |
| `name` | text | NOT NULL UNIQUE |
| `image_url` | text | |
| `sort_order` | integer | DEFAULT 0 |
| `created_at` | timestamptz | DEFAULT now() |

### 13. radar_posts
| 欄位 | 型別 | 約束 |
|------|------|------|
| `id` | bigint | PK |
| `category_id` | bigint | FK → radar_categories.id ON DELETE CASCADE |
| `uploader_id` | uuid | FK → auth.users.id |
| `uploader_nickname` | text | NOT NULL |
| `coordinates` | text | NOT NULL |
| `country` | text | NOT NULL |
| `region` | text | NOT NULL |
| `area` | text | DEFAULT '' |
| `pure_count` | integer | DEFAULT 0 |
| `impure_count` | integer | DEFAULT 0 |
| `created_at` | timestamptz | DEFAULT now() |

### 14. radar_votes
| 欄位 | 型別 | 約束 |
|------|------|------|
| `id` | bigint | PK |
| `post_id` | bigint | FK → radar_posts.id ON DELETE CASCADE |
| `user_id` | uuid | FK → auth.users.id |
| `ip_fingerprint` | text | 訪客投票用 |
| `vote_type` | text | NOT NULL, CHECK IN ('pure','impure') |
| `created_at` | timestamptz | DEFAULT now() |

UNIQUE (post_id, user_id, ip_fingerprint)

### 15. signup_history
| 欄位 | 型別 | 約束 |
|------|------|------|
| `id` | bigint | PK |
| `user_id` | uuid | FK → profiles.id ON DELETE CASCADE |
| `signup_speed` | numeric | |
| `signed_up_at` | timestamptz | NOT NULL |

由 trigger `archive_signup_record` 自動管理，前端不可見。

### 16. signups
| 欄位 | 型別 | 約束 |
|------|------|------|
| `id` | bigint | PK |
| `challenge_id` | bigint | NOT NULL, FK → challenges.id ON DELETE CASCADE |
| `user_id` | uuid | FK → profiles.id ON DELETE CASCADE |
| `signed_up_at` | timestamptz | NOT NULL DEFAULT now() |
| `signup_speed` | numeric(10,3) | 報名速度(秒) |
| `guest_name` | text | 訪客識別 "暱稱💪好友碼" |
| `comment` | text | 報名留言 |
| `user_nickname` | text | trigger 自動從 profiles 填入 |
| `is_checked_in` | boolean | DEFAULT false |

UNIQUE (challenge_id, user_id)

### 17. user_alts
| 欄位 | 型別 | 約束 |
|------|------|------|
| `id` | bigint | PK |
| `user_id` | uuid | NOT NULL, FK → auth.users.id |
| `alt_nickname` | text | NOT NULL |
| `friend_code` | text | NOT NULL |
| `full_display` | text | NOT NULL |
| `created_at` | timestamptz | DEFAULT now() |

### 18. wish_stats
| 欄位 | 型別 | 約束 |
|------|------|------|
| `mushroom_type` | text | PK |
| `count` | integer | DEFAULT 0 |

---

## 四、觸發器詳細分析 (5 個自訂 Trigger)

### 4.1 `on_absent_record_change` → `handle_absent_score_change()`
```
綁定: absent_records
時機: AFTER INSERT OR DELETE
邏輯:
  INSERT → profiles.absent_score +2 (自動)
  DELETE → 不做任何事 (分數不變)
```
**⚠️ `revoke_absentee` RPC 撤銷時，因為 trigger 在 DELETE 不做任何事，所以 RPC 必須手動 -2 補償。**

### 4.2 `on_challenge_dispatch_change` → `handle_host_stats()`
```
綁定: challenges
時機: AFTER UPDATE OF dispatch_status
邏輯:
  '待發'→'已發': profiles.weekly_host_count +1, monthly_host_count +1
  '已發'→其他:   profiles.weekly_host_count -1, monthly_host_count -1 (防呆: 不低於 0)
```

### 4.3 `trigger_delete_old_messages` → `delete_old_messages()`
```
綁定: guest_messages
時機: AFTER INSERT
邏輯: DELETE guest_messages WHERE id NOT IN (SELECT id ... ORDER BY created_at DESC LIMIT 300)
```
每次新留言寫入後自動保留最新 300 則。

### 4.4 `on_signup_delete_archive` → `archive_signup_record()`
```
綁定: signups
時機: BEFORE DELETE
邏輯: INSERT INTO signup_history (user_id, signup_speed, signed_up_at)
      VALUES (OLD.user_id, OLD.signup_speed, OLD.signed_up_at)
```
**⚠️ 只備份 user_id (會員)，訪客的 signup 紀錄被刪除時 `user_id` 為 null，不會留下歷史。**

### 4.5 `trigger_fill_signup_nickname` → `auto_fill_signup_nickname()`
```
綁定: signups
時機: BEFORE INSERT
邏輯: IF NEW.user_id IS NOT NULL THEN
        SELECT nickname INTO NEW.user_nickname FROM profiles WHERE id = NEW.user_id
      END IF
```
`user_nickname` 是自動填入的快取值，程式碼不需要手動寫入。

---

## 五、RPC 函數完整分析

### 5.1 核心業務 RPC（前端/Edge Function 實際呼叫）

#### `signup_for_challenge(p_user_id? NO, challenge_id_to_signup)`
**呼叫者:** dashboard.html（會員報名按鈕）

核心行為：
1. 即使 `status = '已額滿'` 仍允許報名（為了 slots+2 候補機制）
2. 報名尚未開始 (`start_time`) 會拒絕
3. **候補判斷：** `current_count >= slots` → `is_waitlist = true`
4. **絕對上限：** `current_count >= slots + 2` → 拒絕
5. **豁免邏輯：** 訪客菇 (`is_guest = true`) 或 備取 (`is_waitlist = true`) → 不扣每日額度、不擋缺席
6. **懲罰公式：** `(daily_signup_count + absent_score) >= daily_signup_limit` → 拒絕。缺席分數直接吃掉報名額度！
7. 報名成功後更新 profiles (weekly/monthly_count, fastest_time)，並在達到 slots 時更新 challenge status 為 `'已額滿'`

#### `cancel_signup_and_update_challenge(challenge_id_to_cancel)`
**呼叫者:** dashboard.html（取消報名按鈕）

核心行為：
1. 計算排名（比我早報名的人數），判斷是否為備取
2. **備取取消：** 不退還每日額度 (`daily_decrement_value = 0`)
3. **訪客菇正取取消：** 不退還額度
4. **內部菇正取取消：** 退還 1 次額度
5. 刪除 signups 記錄（trigger 自動備份到 signup_history）
6. 如果取消的是最快紀錄，從 signup_history 重新查詢並更新 fastest_time
7. 根據剩餘人數更新 challenge.status

#### `report_absentee(p_challenge_id, p_absentee_id)`
**呼叫者:** dashboard.html（發菇者檢舉缺席）

核心行為：
1. 驗證呼叫者是否為該挑戰的 host
2. INSERT INTO absent_records → trigger 自動 +2 到 profiles.absent_score

#### `revoke_absentee(p_challenge_id, p_absentee_id)`
**呼叫者:** dashboard.html（撤銷缺席）

核心行為：
1. 驗證呼叫者是否為該挑戰的 host
2. DELETE FROM absent_records（trigger 不做任何事）
3. **手動** `profiles.absent_score - 2`（因為 trigger 不處理 DELETE）

#### `submit_wish_transaction(p_user_id, p_types)`
**呼叫者:** Edge Function → dashboard 許願

核心行為：
1. `FOR UPDATE` 鎖定 profiles 行
2. 檢查 `daily_wish_count + 新票數 <= 3`
3. 更新 profiles.daily_wish_count
4. `UPDATE wish_stats SET count = count + 1 WHERE mushroom_type = ANY(p_types)`

#### `update_challenge_countdown(p_challenge_id, p_end_time)`
**呼叫者:** dashboard.html 校時功能

核心行為：更新 challenges.countdown_end_time 欄位

#### `update_last_active()`
**呼叫者:** dashboard.html on load

核心行為：`UPDATE profiles SET last_active_at = now() WHERE id = auth.uid()`

---

### 5.2 查詢類 RPC

| RPC | 用途 | 呼叫者 |
|-----|------|--------|
| `get_database_size_bytes()` | DB 總容量 | Edge Function `get-system-stats` |
| `get_table_stats()` | 各表大小與 rows | Edge Function `get-system-stats` |
| `get_storage_stats()` | Storage bucket 用量 | Edge Function `get-system-stats` |
| `get_users_signin_data(user_ids)` | 最後登入時間 | Edge Function `list-users-with-details` |
| `get_radar_top_posts(p_limit)` | 雷達熱門 Top N | Edge Function `get-radar-home-data` |
| `get_admin_nicknames()` | 管理員暱稱清單 | admin.html login dropdown |

---

### 5.3 排行榜類 RPC

| RPC | 呼叫者 | 邏輯 |
|-----|--------|------|
| `get_host_leaderboard(period_type)` | dashboard marquee | 直接讀 profiles.weekly_host_count/monthly_host_count |
| `get_leaderboard_from_profiles(period_type)` | dashboard marquee | 讀 profiles.weekly/monthly_signup_count |
| `get_speed_leaderboard_from_profiles(period_type)` | dashboard marquee | 讀 profiles.weekly/monthly_fastest_time |
| `get_postcard_leaderboard(period_type)` | dashboard marquee | 讀 profiles.weekly/monthly_postcard_count |
| `get_leaderboard(start_date, end_date)` | 舊版，可能未使用 | JOIN signups 即時計算 |
| `get_speed_leaderboard(start_date, end_date)` | 舊版，可能未使用 | JOIN signups + challenges 即時計算 |

---

### 5.4 排程/維護類 RPC

| RPC | 用途 | 觸發方式 |
|-----|------|----------|
| `open_due_challenges()` | 批次將所有到期挑戰從 `'預計開放'` 改為 `'開放報名中'` | 排程呼叫 |
| `check_and_open_challenge(challenge_id_to_check)` | 單一挑戰開放檢查 | 可能由 Edge Function 呼叫 |
| `delete_old_challenges()` | 刪除已發車超過 8 小時的挑戰 | 排程（已被 Edge Function cleanup-expired 取代） |
| `delete_old_sent_challenges()` | ⚠️ 與上述功能重複，start_time 版本 | 不明 |
| `daily_reduce_absent_score()` | 所有 absent_score > 0 的用戶 -1 | admin.html 手動觸發 |
| `purge_old_signup_history()` | 刪除本月之前的 signup_history | 排程 |
| `reset_all_user_signup_counts()` | 重置所有 daily_signup_count = 0 | 排程（每日） |
| `update_postcard_likes(p_id, p_delta)` | 原子增減按讚數 | Edge Function |
| `update_radar_vote_counts(p_id)` | 重新計算 pure/impure 計數 | Edge Function |

---

### 5.5 ⚠️ 已被取代的舊版 RPC（未被程式碼呼叫）

| 舊函數 | 取代者 | 說明 |
|--------|--------|------|
| `handle_challenge_signup` | `signup_for_challenge` | 無候補邏輯、無訪客菇判斷、無缺席懲罰 |
| `cancel_signup_and_update_status` | `cancel_signup_and_update_challenge` | 無額度返還、無備取判斷、無最速重算 |
| `increment_wishes` | `submit_wish_transaction` | 無原子鎖、無額度檢查 |
| `create_user_with_profile` (v1) | Edge Function `create-user` | 舊版 auth 方式 |
| `create_user_with_profile` (v2) | Edge Function `create-user` | 使用 `auth.signup()` 的另一舊版 |
| `reset_user_password_by_nickname` | Edge Function `reset-user-password` | 透過暱稱而非 UUID 重設密碼 |

---

## 六、關鍵機制深入分析

### 6.1 缺席懲罰的雙重機制

```
report_absentee → absent_records INSERT → trigger: profiles.absent_score +2
                  ↓
下次報名時 signup_for_challenge 檢查:
  (daily_signup_count + absent_score) >= daily_signup_limit → 拒絕報名

revoke_absentee → absent_records DELETE → trigger: 無動作
                  ↓
                 RPC 手動: profiles.absent_score -2
```

**影響：** `absent_score = 2` 的用戶在每日上限 3 次下，實際只能報名 1 次。這是刻意設計的懲罰機制，不是 bug。

### 6.2 候補制度（signup_for_challenge）

```
報名時檢查:
  current_count >= slots      → 備取 (is_waitlist = true)
  current_count >= slots + 2  → 拒絕

備取豁免:
  - 不扣 daily_signup_count
  - 不檢查 absent_score 懲罰
  - 不計算 signup_speed（因為使用 LEAST 可能被覆蓋? 這裡有潛在問題）

取消時:
  備取取消 → 不退額度
  正取取消(訪客菇) → 不退額度
  正取取消(內部菇) → 退 1 次
```

### 6.3 signups 刪除時的自動歸檔

```
DELETE signups → trigger archive_signup_record
  → INSERT signup_history (user_id, signup_speed, signed_up_at)

限制: 只備份 user_id (會員)，訪客的 guest_name 不會歸檔
用途: 取消報名後重新計算最速紀錄時查詢
```

### 6.4 排行榜數據來源

| 排行榜 | RPC | 數據來源 |
|--------|-----|---------|
| 發菇王 | `get_host_leaderboard` | profiles.weekly/monthly_host_count (由 trigger handle_host_stats 維護) |
| 報名王 | `get_leaderboard_from_profiles` | profiles.weekly/monthly_signup_count (由 signup_for_challenge 增加) |
| 最速傳說 | `get_speed_leaderboard_from_profiles` | profiles.weekly/monthly_fastest_time (由 signup_for_challenge 更新 LEAST) |
| 美片王 | `get_postcard_leaderboard` | profiles.weekly/monthly_postcard_count (由 Edge Function add-postcard/delete-postcard 維護) |

---

## 七、廢棄項目清單

### 7.1 廢棄欄位（程式碼從未讀寫）

| 欄位 | 表 | 風險評估 |
|------|-----|---------|
| `challenges.current_players` | challenges | 安全可刪，人數由 signups count 計算 |
| `postcard_likes.guest_id` | postcard_likes | 安全可刪，訪客按讚走 guest_postcard_likes 表 |
| `profiles.claimed_at` | profiles | 安全可刪，全站無引用 |

### 7.2 未使用的 Enum 值

| 值 | 類型 | 說明 |
|----|------|------|
| `'已配達'` | challenge_status | 定義存在但從未寫入或讀取 |

### 7.3 未被呼叫的舊版 RPC（6 個）

| RPC | 建議 |
|-----|------|
| `handle_challenge_signup` | 可刪，功能已被 `signup_for_challenge` 完全取代 |
| `cancel_signup_and_update_status` | 可刪，功能已被 `cancel_signup_and_update_challenge` 取代 |
| `increment_wishes` | 可刪，功能已被 `submit_wish_transaction` 取代 |
| `create_user_with_profile` (兩版本) | 可刪，功能已被 Edge Function `create-user` 取代 |
| `reset_user_password_by_nickname` | 可刪，功能已被 Edge Function 取代 |
| `delete_old_sent_challenges` | 可刪，與 `delete_old_challenges` 重複且 Edge Function 已有 cleanup |
| `get_leaderboard` | 可刪，已被 `get_leaderboard_from_profiles` 取代 |
| `get_speed_leaderboard` | 可刪，已被 `get_speed_leaderboard_from_profiles` 取代 |
