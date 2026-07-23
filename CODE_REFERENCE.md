# 菇菇宅配網 — 程式碼完整參考手冊

> 自動生成於 2026-07-21，涵蓋所有 HTML 頁面與 Edge Function 的變數、函數、資料表與邏輯。
> **完整 DB Schema、RPC 原始碼、Trigger 分析請見 `DB_SCHEMA.md`**
> 編輯程式碼前請先查閱本文，避免靠猜測導致 A 功能修好卻弄壞 B、C 功能。

---

## 一、系統總覽

| 層 | 技術棧 | 部署位置 |
|----|--------|----------|
| 前端 | Vanilla HTML/CSS/JS + Tailwind CDN + Supabase JS SDK v2 | GitHub Pages (`yyyiying.github.io/pikmin_app/`) |
| 後端 | Supabase (PostgreSQL + Auth + Storage + Realtime) | `htdddmoclmhqebyvzean.supabase.co` |
| 邊緣函數 | Deno (`supabase/functions/admin-actions/index.ts`) | Supabase Edge Functions |
| 排程 | GitHub Actions cron.yml | 每 30 分鐘觸發（TW 08:00-23:30） |
| 圖片 CDN | Cloudflare Worker | `pikmin-cdn.secretsoulful.workers.dev` |

**關鍵架構決策：**
- 所有 DB 寫入都透過 Edge Function（service role key），前端不使用 RLS 寫入
- **例外：** dashboard 的報名/取消報名使用 RPC (`signup_for_challenge`, `cancel_signup_and_update_challenge`)，這是因為需要在資料庫層做原子鎖避免超額報名
- 訪客報名不走 RPC 而走 Edge Function (`guest-join-challenge`)，因為訪客無 JWT 無法通過 RLS
- 所有 HTML 檔案為自包含單檔（inline CSS + JS），無 build system
- 訪客以 IP fingerprint 識別（SHA-1 of `clientIp + 'SALT_2025'`）

**未來重構方向（已確認）：**
- Edge Function 歡迎拆分：維持單一入口 `admin-actions`，內部抽成多個 TypeScript 模組
- Email 訂閱功能可刪除前端 UI + cron 中的 email 通知部分，但 `daily_settings` (指紋) 和 `cleanup-expired` (定時清理) 必須保留
- DDL SQL schema 待使用者提供後補入本文件

---

## 二、前端頁面清單

| 檔案 | 用途 | 需要登入 | 技術特點 |
|------|------|----------|----------|
| `index.html` | 登入頁 (280行) | 否 | 雙軌 email 登入 (hex + url-encoded)、暱稱下拉搜尋 |
| `dashboard.html` | 主控台 (4013行) | 是 | 挑戰 CRUD、報名、排行榜、許願池、音樂播放器、分身管理、已入點名 |
| `guest.html` | 訪客專區 (4070行) | 否 | 訪客大聲公、自飛菇、聊天室、i18n 多語言 |
| `admin.html` | 管理後台 (1435行) | 是(管理者) | 用戶管理、DB 設定、留言管理、挑戰管理 |
| `gallery.html` | 美片藝廊 (1169行) | 否 | 公開明信片瀏覽、上傳、按讚、絕版回報 |
| `postcard.html` | 美片圖書館 (905行) | 是 | 會員明信片 CRUD、按讚、座標格式化 |
| `radar.html` | 純點雷達站 (1385行) | 否(可選) | 蘑菇地點資料庫、純/不純投票、分類管理 |
| `partner.html` | 村民好友碼名冊 (213行) | 否 | 從 profiles 解析好友碼、即時搜尋 |
| `gpx_generator.html` | GPX 路線生成器 (1408行) | 是(檢查用) | Canvas 地圖編輯、花朵路徑演算法、GPX 匯出 |
| `monitor.html` | 系統資源監控 (202行) | 否 | DB/Storage 容量圖表、Table 排行 |
| `migration.html` | 美片搬家公司 (278行) | 是(管理者) | 從圖書館遷移明信片到藝廊 |
| `dedupe.html` | 重複美片清理 (805行) | 是 | 跨表座標去重、精確+模糊比對 |

---

## 三、Supabase 資料庫表格與欄位

### 3.1 `profiles` — 使用者檔案
```
id (UUID, PK) → auth.users.id
nickname (text)
role (text) — '管理者' | '發菇者' | '發菇及報名者' | ...
daily_signup_count (int)
daily_wish_count (int)
absent_score (int)
weekly_postcard_count (int)
monthly_postcard_count (int)
is_subscribed_signup (boolean)
is_subscribed_full (boolean)
notes (text)
last_active_at (timestamptz)
```
**直接存取頁面:** dashboard, admin, postcard, radar, gallery, partner

### 3.2 `challenges` — 蘑菇挑戰
```
id (serial, PK)
host_id (UUID) → profiles.id (null for guests)
display_host_name (text) — "暱稱✈️好友碼" 格式
mushroom_type (text) — 巨菇/活動菇/大火/大水/...
slots (int)
start_time (timestamptz)
details (text) — 宵夜/早餐/午餐/下午茶/晚餐/滿人開
cooking_style (text) — 大火快炒/細火慢燉/隨便亂炒
notes (text)
image_url (text)
status (enum) — '預計開放' | '開放報名中' | '已額滿' | '已配達'(未使用)
dispatch_status (text) — '待發' | '已發'
dispatched_at (timestamptz)
is_guest (boolean)
guest_ip (text)
countdown_end_time (timestamptz) — 校時後的結束時間
created_at (timestamptz)
```
**直接存取頁面:** dashboard, admin

### 3.3 `signups` — 報名記錄
```
id (serial, PK)
challenge_id (int) → challenges.id
user_id (UUID) → profiles.id (null for guests)
guest_name (text) — "暱稱💪好友碼"
is_checked_in (boolean, default false)
comment (text)
signed_up_at (timestamptz)
```
**直接存取頁面:** dashboard

### 3.4 `guest_fly_posts` — 訪客自飛菇
```
id (serial, PK)
nickname (text)
friend_code (text)
mushroom_type (text)
slots (int) — 已進場人數 (上限 20)
coordinates (text)
cooking_style (text)
notes (text)
image_url (text)
guest_ip (text)
created_at (timestamptz)
```
**直接存取頁面:** admin (read)

### 3.5 `guest_messages` — 訪客留言板
```
id (serial, PK)
nickname (text)
message (text)
ip_fingerprint (text) — SHA-1 前 6 碼
created_at (timestamptz)
```
**直接存取頁面:** admin (read), guest (realtime)

### 3.6 `postcards` — 會員美片圖書館
```
id (serial, PK)
uploader_id (UUID) → profiles.id
uploader_nickname (text)
coordinate (text) — "lat, lng"
image_url (text)
tags (text[])
country, region, area (text)
likes (int)
is_obsolete (boolean)
created_at (timestamptz)
```
**直接存取頁面:** postcard, dedupe, migration, dashboard(美片選擇器)

### 3.7 `postcard_likes` — 美片按讚
```
postcard_id (int) → postcards.id
user_id (UUID) → profiles.id
```

### 3.8 `guest_postcards` — 訪客美片藝廊
```
id (serial, PK)
nickname (text)
friend_code (text)
ip_fingerprint (text) — 'system_import' 表示從圖書館遷入
coordinate (text)
image_url (text)
tags (text[])
country, region, area (text)
likes (int)
is_obsolete (boolean)
created_at (timestamptz)
```
**直接存取頁面:** gallery, dedupe, migration, dashboard(美片選擇器)

### 3.9 `guest_postcard_likes` — 藝廊按讚
```
postcard_id (int) → guest_postcards.id
ip_fingerprint (text)
```

### 3.10 `radar_posts` — 雷達地點
```
id (serial, PK)
category_id (int) → radar_categories.id
coordinates (text)
country, region, area (text)
uploader_nickname (text)
uploader_id (UUID) → profiles.id
pure_count (int)
impure_count (int)
created_at (timestamptz)
```

### 3.11 `radar_categories` — 雷達分類
```
id (serial, PK)
name (text)
image_url (text)
sort_order (int)
```

### 3.12 `radar_votes` — 雷達投票
```
id (serial, PK)
post_id (int) → radar_posts.id
user_id (UUID) → profiles.id (null for guests)
ip_fingerprint (text) — for guest voters
vote_type (text) — 'pure' | 'impure'
```

### 3.13 `daily_settings` — 系統設定
```
setting_name (text, PK) — 'daily_signup_limit' | 'last_signup_notify_fingerprint' | 'last_full_notify_fingerprint'
setting_text (text) — 指紋字串
setting_value (int) — 數值設定
updated_at (timestamptz)
```

### 3.14 其他表格
```
wish_stats — 許願統計 (mushroom_type, count)
user_alts — 分身帳號 (user_id, nickname, friend_code)
partners — 好友碼名冊 (name, ...)
absent_records — 缺席記錄 (由 RPC 操作)
```

---

## 四、Supabase Storage Buckets

| Bucket | 上傳頁面 | 用途 | 公開 |
|--------|----------|------|------|
| `challenge-images` | dashboard, guest | 挑戰圖片、自飛菇圖片 | 是 |
| `postcard-images` | postcard, dedupe | 會員美片圖 | 是 |
| `guest-postcard-images` | gallery, dedupe | 藝廊美片圖 | 是 |
| `radar-category-images` | radar | 雷達分類圖示 | 是 |

**圖片 URL 轉 CDN:**
```js
function getCdnUrl(url) {
    if (!url) return '';
    if (url.includes('htdddmoclmhqebyvzean.supabase.co')) {
        return url.replace('https://htdddmoclmhqebyvzean.supabase.co', CDN_HOST);
    }
    return url;
}
```

---

## 五、Edge Function 完整 Action 列表

### 5.1 公開 Actions（無需 Auth）

| Action | Payload | 功能 | 呼叫頁面 |
|--------|---------|------|----------|
| `scheduled-email-notify` | — | 排程：發送報名通知 | cron.yml |
| `scheduled-full-notify` | — | 排程：發送額滿待發通知 | cron.yml |
| `cleanup-expired` | — | 排程：清除逾時挑戰(10h/12h)與孤兒圖片 | cron.yml |
| `get-radar-home-data` | — | 取得雷達首頁 Top 3 資料 | radar |
| `reverse-geocode` | `{lat, lng}` | 反查地址 (Nominatim API proxy) | postcard, radar, gallery, dedupe |
| `list-guest-postcards` | — | 讀取藝廊列表 (含 IP 按讚狀態) | gallery, dashboard |
| `add-guest-postcard` | `{nickname, friendCode, coordinate, ...}` | 發布訪客美片 (含座標去重) | gallery |
| `edit-guest-postcard` | `{id, nickname, friendCode, ...}` | 編輯訪客美片 (IP/管理員驗證) | gallery, dedupe |
| `delete-guest-postcard` | `{id, nickname, friendCode}` | 刪除訪客美片 | gallery, dedupe |
| `toggle-guest-postcard-like` | `{postcardId}` | 訪客按讚切換 (IP 指紋) | gallery |
| `toggle-guest-postcard-obsolete` | `{postcardId}` | 絕版狀態切換 | gallery |
| `migrate-postcards` | `{ids}` | 管理員遷移美片到藝廊 | migration |
| `get-guest-daily-count` | — | 查詢訪客今日發布上限 | guest |
| `list-guest-challenges` | — | 讀取訪客挑戰列表 | guest |
| `get-guest-challenge` | `{challengeId}` | 讀取單筆訪客菇(編輯用) | guest |
| `guest-create-challenge` | `{nickname, friendCode, mushroomType, ...}` | 訪客發菇 (IP 限制) | guest |
| `guest-edit-challenge` | `{challengeId, ...}` | 訪客編輯挑戰 | guest |
| `guest-delete-challenge` | `{challengeId}` | 訪客刪除挑戰 | guest |
| `guest-join-challenge` | `{challengeId, nickname, friendCode}` | 訪客報名 (含 slots+2 候補) | guest |
| `guest-cancel-signup` | `{challengeId, nickname, friendCode}` | 訪客取消報名 | guest |
| `guest-update-signup-comment` | `{challengeId, nickname, friendCode, comment}` | 更新報名留言 | guest |
| `list-guest-fly` | — | 讀取自飛列表 (含自動清理 3h) | guest, admin |
| `guest-create-fly` | `{nickname, friendCode, mushroomType, ...}` | 發布自飛菇 (IP 限制) | guest |
| `guest-edit-fly` | `{id, ...}` | 編輯自飛菇 | guest |
| `guest-delete-fly` | `{id}` | 刪除自飛菇 | guest, admin |
| `guest-increment-fly` | `{id}` | 自飛菇人數 +1 (上限 20) | guest |
| `guest-send-message` | `{nickname, message}` | 發送訪客留言 (IP 指紋) | guest |
| `guest-edit-message` | `{id, message}` | 編輯留言 (IP 驗證) | guest |
| `guest-delete-message` | `{id}` | 刪除留言 (IP 驗證) | guest |
| `get-radar-categories` | — | 取得雷達分類清單 | radar |
| `get-radar-posts` | `{categoryId}` | 取得特定分類雷達點 | radar |
| `create-radar-post` | `{categoryId, coordinates, ...}` | 發布雷達點 (座標去重) | radar |
| `update-radar-post` | `{postId, coordinates, ...}` | 編輯雷達點 (本人/管理員) | radar |
| `vote-radar-post` | `{postId, type}` | 投票純/不純 (user 或 IP) | radar |

### 5.2 需登入 Auth 的 Actions

| Action | Payload | 功能 | 呼叫頁面 |
|--------|---------|------|----------|
| `user-update-nickname` | `{newNickname}` | 修改暱稱 (更新 Auth email + profile + partners) | dashboard |
| `submit-wish` | `{types: [...]}` | 許願 (呼叫 submit_wish_transaction RPC) | dashboard |
| `update-subscription` | `{userId, type, status}` | 訂閱/取消 email 通知 | dashboard |
| `toggle-signup-checked-in` | `{signupId, challengeId}` | 發菇者點名 (切換已入狀態) | dashboard |
| `user-update-signup-comment` | `{challengeId, comment}` | 更新自己報名留言 | dashboard |
| `add-postcard` | `{uploaderId, uploaderNickname, coordinate, ...}` | 發布會員美片 (座標去重) | postcard |
| `edit-postcard` | `{postcardId, coordinate, tags, ...}` | 編輯會員美片 (本人/管理員) | postcard, dedupe |
| `delete-postcard` | `{postcardId}` | 刪除會員美片 | postcard, dedupe |
| `toggle-postcard-like` | `{postcardId}` | 切換按讚 (user 驗證) | postcard |
| `toggle-postcard-obsolete` | `{postcardId}` | 切換絕版狀態 | postcard |
| `delete-radar-post` | `{postId}` | 刪除雷達點 (本人/管理員) | radar |
| `update-radar-category` | `{id, name, image_url}` | 編輯分類 (僅管理員) | radar |

### 5.3 管理員專屬 Actions

| Action | Payload | 功能 | 呼叫頁面 |
|--------|---------|------|----------|
| `admin-delete-message` | `{id}` | 刪除單一留言 | admin |
| `admin-clear-chat` | — | 清空所有留言 | admin |
| `admin-batch-delete-messages` | `{ids}` | 批量刪除留言 | admin |
| `list-users-with-details` | — | 取得用戶清單 (含最後登入) | admin |
| `send-test-email` | — | 發送測試信 | admin |
| `trigger-check-now` | — | 手動觸發報名通知 | admin |
| `get-subscriber-counts` | — | 統計訂閱人數 | admin |
| `delete-challenge` | `{challengeId}` | 管理員刪除挑戰 | admin |
| `scan-duplicate-coordinates` | — | 掃描跨表重複座標 | —(dedupe 有獨立版本) |
| `create-user` | `{nickname, password, role}` | 建立新用戶 | admin |
| `update-user-role` | `{userId, role}` | 修改用戶角色 | admin |
| `reset-user-password` | `{userId, password}` | 重設密碼 | admin |
| `delete-user` | `{userId}` | 刪除用戶 | admin |
| `update-user-nickname` | `{userId, oldNickname, newNickname, notes}` | 管理員改用戶暱稱 | admin |
| `get-daily-limit` | — | 取得每日報名上限 | admin |
| `set-daily-limit` | `{value}` | 設定每日報名上限 | admin |
| `daily-reset-absent` | — | 每日缺席分數 -1 | admin |
| `ping` | — | DB 連線檢測 | admin |
| `get-system-stats` | — | 取得系統資源統計 | monitor |

---

## 六、Supabase RPC Functions（資料庫函數）

> 所有 RPC 的完整原始碼見 `DB_SCHEMA.md`

### 6.1 核心業務 RPC

| RPC | 實際參數 | 用途 | 呼叫位置 |
|-----|---------|------|----------|
| `signup_for_challenge` | `(challenge_id_to_signup)` | 原子報名，無候補(slots 滿即拒) + 缺席懲罰(>=3停權) | dashboard |
| `cancel_signup_and_update_challenge` | `(challenge_id_to_cancel)` | 原子取消，含最速重算 | dashboard |
| `report_absentee` | `(p_challenge_id, p_absentee_id)` | 檢舉缺席 → trigger 自動 **+2** absent_score | (後端仍在，dashboard 前端已移除按鈕) |
| `revoke_absentee` | `(p_challenge_id, p_absentee_id)` | 撤銷缺席 → 手動 **-2** (trigger 不處理 DELETE) | (後端仍在，dashboard 前端已移除按鈕) |
| `submit_wish_transaction` | `(p_user_id, p_types)` | 許願交易，FOR UPDATE 原子鎖，上限 3 票 | Edge Function |
| `update_challenge_countdown` | `(p_challenge_id, p_end_time)` | 校時：更新 countdown_end_time | dashboard |
| `update_last_active` | — | 更新 last_active_at | dashboard |

### 6.2 ⚠️ 關鍵機制：缺席分數停權制（dashboard 前端已移除顯示/按鈕，後端 RPC 仍檢查）

`signup_for_challenge` 的阻擋公式（2026-07-21 改制）：
```
absent_score >= 3 → 拒絕報名（每日 -1 自動恢復）
```
**缺席分數 >= 3 時直接停權，不影響每日報名額度。** 每日 `daily_reduce_absent_score` 會讓所有人的 absent_score -1，所以停權最多持續 3 天。

### 6.3 輔助類 RPC

| RPC | 參數 | 用途 | 呼叫位置 |
|-----|------|------|----------|
| `update_radar_vote_counts` | `(p_id)` | 重新計算 pure/impure 計數 | Edge Function |
| `update_postcard_likes` | `(p_id, p_delta)` | 原子增減按讚數 | Edge Function |
| `get_users_signin_data` | `(user_ids)` | 取得 Auth 最後登入時間 | Edge Function |
| `get_database_size_bytes` | — | DB 總容量 | Edge Function |
| `get_table_stats` | — | 各資料表大小排行 | Edge Function |
| `get_storage_stats` | — | Storage bucket 用量 | Edge Function |
| `get_radar_top_posts` | `(p_limit)` | 雷達熱門 Top N | Edge Function |
| `get_admin_nicknames` | — | 管理員暱稱清單 | admin |

### 6.4 排行榜 RPC

| RPC | 數據來源 |
|-----|---------|
| `get_host_leaderboard(period_type)` | profiles.weekly/monthly_host_count |
| `get_leaderboard_from_profiles(period_type)` | profiles.weekly/monthly_signup_count |
| `get_speed_leaderboard_from_profiles(period_type)` | profiles.weekly/monthly_fastest_time |
| `get_postcard_leaderboard(period_type)` | profiles.weekly/monthly_postcard_count |

### 6.5 排程/維護 RPC

| RPC | 用途 |
|-----|------|
| `daily_reduce_absent_score` | 所有 absent_score > 0 者 -1 (admin 手動觸發) |
| `delete_old_messages` | trigger 自動，保留最新 300 則留言 |
| `open_due_challenges` | 批次將到期挑戰從預計開放改為開放報名中 |
| `purge_old_signup_history` | 刪除本月之前的 signup_history |
| `reset_all_user_signup_counts` | 所有 daily_signup_count 歸零 |

### 6.6 ⚠️ 已被取代的舊版 RPC（程式碼未呼叫，可安全刪除）

| 舊版 | 取代者 |
|------|--------|
| `handle_challenge_signup` | `signup_for_challenge` |
| `cancel_signup_and_update_status` | `cancel_signup_and_update_challenge` |
| `increment_wishes` | `submit_wish_transaction` |
| `create_user_with_profile` (兩個版本) | Edge Function `create-user` |
| `reset_user_password_by_nickname` | Edge Function `reset-user-password` |
| `get_leaderboard` | `get_leaderboard_from_profiles` |
| `get_speed_leaderboard` | `get_speed_leaderboard_from_profiles` |
| `delete_old_sent_challenges` | Edge Function `cleanup-expired` |

---

## 七、前端全域變數與函數對照表

### 7.1 dashboard.html 核心變數

```js
// Supabase
SUPABASE_URL, SUPABASE_ANON_KEY, supabaseClient
CDN_HOST = 'https://pikmin-cdn.secretsoulful.workers.dev'

// 狀態
currentUserProfile          // profiles row
challengesData = {}         // key: challenge id
userSignedUpChallengeIds    // Set<number>
onlineNicknames = []        // 在線名單
signupIdToChallengeMap = {} // signupId → challengeId

// 控制
activeFilter = 'all'        // all | imported | full | signed-up | hosted
globalCooldownUntil = 0     // 簽到冷卻時間戳
challengeToDeleteId = null  // 待刪除 ID

// 排行榜
currentLeaderboardPeriod = 'week'  // week | month
currentLeaderboardType = 'host'    // host | count | speed | postcard

// 美片選擇器
currentLibraryTargetInputId // 目標 input element id
currentArtTab = 'library'   // library | gallery
artCache = { library: null, gallery: null }
artPages = { library: 1, gallery: 1 }
libItemsPerPage = 24
```

### 7.2 guest.html 核心變數

```js
SUPABASE_URL, PUBLIC_KEY, supabaseClient
CDN_HOST

// 狀態
myGuestPostIds = []         // 自己的挑戰 ID (localStorage)
myFlyPostIds = []           // 自己的自飛 ID (localStorage)
myIpFingerprint             // IP 指紋 (從 Edge Function 取得)
onlineFingerprints          // Set<string>
activeFilter = 'all'        // all | fly | normal | full | signed | mine
globalCooldownUntil = 0     // 全域冷卻
window.currentAllData = []  // 合併後的挑戰+自飛資料

// 暫存
guest_nick, guest_code      // localStorage keys
my_guest_signups            // localStorage: [{challengeId, timestamp}]
guest_saved_time, guest_is_remembered  // localStorage
bg_music_muted              // localStorage

// 藝廊選擇器
galleryData, galleryPage, galleryPerPage, targetInputId
```

### 7.3 admin.html 核心變數

```js
SUPABASE_URL, PUBLIC_KEY, supabaseClient

// 狀態
allUsersData = []                   // 用戶清單
currentSortColumn = 'nickname'
currentSortDirection = 'asc'
userToEdit = null                   // 正在編輯的用戶
adminNicknames = []                 // 管理員暱稱（登入下拉）
dbConnectionInterval = null         // DB ping 定時器
```

### 7.4 postcard.html 核心變數

```js
SUPABASE_URL, SUPABASE_ANON_KEY, supabaseClient, CDN_HOST
currentUser             // {id, nickname, role}
allPostcards = []       // 所有美片
activeTag = 'all'       // all | tagName | 'obsolete'
uniqueCountries, uniqueRegions, uniqueAreas  // Set
currentPage = 1
itemsPerPage = 24
```

### 7.5 radar.html 核心變數

```js
SUPABASE_URL, PUBLIC_KEY, supabaseClient
currentUser = null      // {id, nickname, role} or null
currentCategory = null  // 目前選中的分類
allCategories = []      // 所有分類
allPosts = []           // 目前顯示的雷達點
isEditing = false       // 是否編輯模式
isImpureMode = false    // 是否不純模式
isAdmin = false
uniqueCountries, uniqueRegions, uniqueAreas  // Set
```

### 7.6 gallery.html 核心變數

```js
SUPABASE_URL, PUBLIC_KEY, supabaseClient, CDN_HOST
allCards = []           // 所有藝廊明信片
activeTag = 'all'
uniqueCountries, uniqueRegions, uniqueAreas  // Set
guestNick, guestCode    // 從 localStorage 讀取
myIpFingerprint         // 從 Edge Function 取得
isAdmin = false
currentUser = null
currentPage = 1
itemsPerPage = 24
```

### 7.7 partner.html 核心變數

```js
SUPABASE_URL, SUPABASE_ANON_KEY, supabaseClient
allPartners = []  // [{displayName, friendCode, fullSearch}]
```

### 7.8 gpx_generator.html 核心變數

```js
SUPABASE_URL, SUPABASE_ANON_KEY, supabaseClient
centers = []              // 花朵中心座標
pathPoints = []           // 路徑點
flowerOverrides = {}      // index → {entryAngle, apexAngle, sideAngle, exitAngle}
globalParams              // 預設角度參數
selectedIndex = -1
scale, offsetX, offsetY   // 畫布視口
FIXED_ALGO_DIST, FIXED_ENTRY_DIST, FIXED_CROSS_FACTOR, FIXED_SIDE_DIST, METERS_PER_DEGREE
```

### 7.9 dedupe.html 核心變數

```js
SUPABASE_URL, PUBLIC_KEY, supabaseClient
currentTabData = { exact: [...], fuzzy: [...] }  // 重複分組
activeTab = 'exact'  // exact | fuzzy
```

### 7.10 migration.html 核心變數

```js
SUPABASE_URL, PUBLIC_KEY, supabaseClient
allLibraryCards = []           // 圖書館卡片
existingGalleryUrls = new Set() // 已遷移的 URL
selectedIds = new Set()         // 選中要遷移的 ID
isAdmin = false
```

---

## 八、LocalStorage Key 完整清單

| Key | 類型 | 使用頁面 | 用途 |
|-----|------|----------|------|
| `rememberedNickname` | string | index | 記住上次登入暱稱 |
| `guest_nick` | string | guest, gallery | 訪客暱稱 |
| `guest_code` | string | guest, gallery | 訪客好友碼 |
| `guest_temp_id` | string | guest | 匿名 Guest_NNN ID |
| `my_guest_post_ids` | JSON array | guest | 自己發布的挑戰 ID |
| `my_fly_post_ids` | JSON array | guest | 自己發布的自飛 ID |
| `my_guest_signups` | JSON array | guest | `[{challengeId, timestamp}]` |
| `guest_saved_time` | string | guest | 記住時間 HH:MM |
| `guest_is_remembered` | bool | guest | 是否記住時間 |
| `guest_saved_notes` | string | guest | 記住備註 |
| `bg_music_muted` | string | dashboard, guest | 音樂靜音狀態 |
| `i18n_user_preference` | string | guest | 語言偏好 (zh-TW/en/ja/ko) |
| `rememberedChallengeTime` | string | dashboard | 記住發菇時間 |
| `rememberedChallengeDetails` | string | dashboard | 記住發菇時段 |
| `rememberedCookingStyle` | string | dashboard | 記住火侯 |
| `rememberedIdentity` | string | dashboard | 記住發布身分 |
| `rememberedNotes` | string | dashboard | 記住備註 |
| `sb-...-auth-token` | (SDK) | 多頁面 | Supabase Auth token |

---

## 九、關鍵資料流

### 9.1 登入雙軌制 (index.html)
```
用戶輸入暱稱 → 
  1. 新制: UTF-8 → hex → "{hex}@pikmin.sys"
  2. 舊制 (fallback): 去符號 → encodeURIComponent → "{clean}@pikmin.sys"
  → Supabase Auth signInWithPassword
  → 成功 → 跳轉 dashboard.html
```

### 9.2 挑戰報名流程 (dashboard.html)
```
點擊報名 → RPC signup_for_challenge (原子鎖)
  → 成功: userSignedUpChallengeIds.add(id), 3秒全域冷卻, refresh
  → 失敗: 顯示錯誤, 重新載入卡片
```

### 9.3 訪客報名流程 (guest.html)
```
點擊報名 → Edge Function guest-join-challenge
  → IP 限制檢查 (每日10則)
  → slots+2 候補機制
  → 備取上限3個
  → 成功: 記入 localStorage, 4秒冷卻
```

### 9.4 排程通知流程
```
GitHub Actions cron (每30分)
  → POST Edge Function
  → 1. scheduled-email-notify: 指紋比對 → 有變化才發
  → 2. scheduled-full-notify: 時段過濾 + 指紋比對
  → 3. cleanup-expired: 刪除逾時+孤兒圖片
  → 郵件透過 Resend API → Relay 到 Google Groups
```

### 9.5 圖片上傳流程
```
選擇檔案 → Compressor.js 壓縮 (quality 0.6, max 1600px)
  → supabaseClient.storage.from(bucket).upload(fileName, file)
  → 取得 publicUrl → 存入對應資料表
  → (若為編輯且換圖) 刪除舊圖: url.split('/').pop()?.split('?')[0]
```

### 9.6 即時更新 (Realtime)
```
dashboard.html:
  - channel 'room_db_changes': challenges(*), signups(*) → reloadChallengeCard
  - channel 'online-users': presence → 在線名單

guest.html:
  - channel 'guest-room': presence → 在線訪客數
  - channel 'guest-realtime-system': challenges, signups, guest_fly_posts → 重載列表

partner.html:
  - channel 'profiles-change': profiles(*) → loadPartners

admin.html:
  - channel 'admin-realtime': challenges, messages, profiles → 自動重載
```

---

## 十、處理圖片 URL 的通用模式

```js
// 1. CDN 替換 (dashboard, guest, postcard, gallery)
function getCdnUrl(url) {
    if (!url) return '';
    if (url.includes('htdddmoclmhqebyvzean.supabase.co')) {
        return url.replace('https://htdddmoclmhqebyvzean.supabase.co', CDN_HOST);
    }
    return url;
}

// 2. 從 URL 解析檔名以刪除舊圖 (Edge Function 中)
const fileName = url.split('/').pop()?.split('?')[0];
// 濾除 ?token=... 等 query params

// 3. 圖片壓縮 (Compressor.js)
new Compressor(file, {
    quality: 0.6,
    maxWidth: 1600,
    maxHeight: 1600,
    success(result) { /* upload */ }
});
```

---

## 十一、注意事項與常見陷阱

1. **`is_checked_in` 不可靠:** 使用 `!!` 強制轉型（可能為 null）
2. **status 值刻意相容:** `challenge_status` enum 共四值：`'預計開放'`、`'開放報名中'`、`'已額滿'`、`'已配達'`（歷史遺留）。排序和樣式邏輯同時相容 `'開放報名中'` 和舊的 `'報名中'`。
3. **每日額度 dashboard 已移除（2026-07-21）：** header 不再顯示「本日額度」，報名不再受每日次數限制。後端 RPC 仍記錄 `daily_signup_count`（用於排行榜），但不再檢查 `daily_signup_limit`。
4. **缺席/💤 dashboard 已移除前端（2026-07-21）：** 💤+N 顯示、缺席/撤銷按鈕已移除。後端 RPC (`report_absentee`/`revoke_absentee`) 和 trigger 仍在（用於 guest 頁面）。缺席改制為 `absent_score >= 3` 即停權，每日 -1 自動恢復。
5. **會員報名無候補：** `signup_for_challenge` RPC 改為 slots 直達上限即拒絕。訪客報名 (`guest-join-challenge`) 仍保留 slots+2 候補機制。
6. **座標去重:** `postcards` 和 `radar_posts` 在 Edge Function 層級強制唯一座標
7. **訪客每日上限:** 大聲公 + 自飛合計 10 則/天/IP
8. **圖片刪除:** 編輯/刪除記錄時必須手動刪 Storage 舊圖
9. **分身顯示:** display_host_name 格式為 `"暱稱✈️好友碼"`，主帳號後綴以 `(...)` 顯示
10. **美片搬遷:** `ip_fingerprint = 'system_import'` 代表從圖書館遷入，受刪除保護
11. **冷卻保護:** dashboard 3 秒、guest 4 秒的全域按鈕冷卻
12. **Edge Function Auth 分界線:** 約在第 1871 行，之後的所有 action 都需要 JWT
13. **Windows 開發:** 使用 forward slash 引用 HTML 路徑
14. **i18n:** 僅 guest.html 有多語言支援 (zh-TW/en/ja/ko)，其他頁面固定中文
