# 菇菇宅配網 — Dashboard 功能完整分析

> 訪談產出，2026-07-21。用於後續修改時查閱，確保不遺漏功能或影響其他模組。

## 變更記錄

| 日期 | 變更內容 |
|------|----------|
| 2026-07-21 | 預設名額 4→6；移除備取 UI/邏輯；排序相容舊狀態值 |
| 2026-07-21 | 移除 header「本日額度」顯示；移除 `updateQuotaDisplay()` |
| 2026-07-21 | 移除報名清單中「缺席/撤銷」按鈕；移除 `reportAbsent`/`revokeAbsent`/`syncUserStatusOnAllCards` |
| 2026-07-21 | 移除 header 和參加者名單中的 💤+N 顯示；移除 `dailyCount` 顯示 |
| 2026-07-21 | 保留已入點名開關和 signup_speed 追蹤（排行榜最速傳說用） |

---

## 頁面架構概覽

dashboard.html 共 4257 行，HTML 約 967 行（Modal + 表單結構），JavaScript 約 3290 行。整個頁面是一個巨型自包含檔案，無外部 JS 依賴（除了 CDN 的 Tailwind、Supabase SDK、html2canvas）。

主要功能模組：
1. 頁面初始化與狀態管理
2. 頂部導航 + 權限控制
3. 快訊跑馬燈
4. 許願池
5. 挑戰卡片列表（核心）
6. 發布/編輯挑戰 Modal
7. 報名/取消流程
8. 校時功能
9. 缺席檢舉
10. 排行榜
11. 音樂播放器（YouTube）
12. 美片選擇器
13. 分身管理
14. 截圖
15. Realtime 即時更新
16. 線上人員 Presence

---

## 初始化流程 (initializePage)

```js
1. RPC update_last_active (容錯)
2. SELECT daily_settings WHERE setting_name='daily_signup_limit' → window.dailySignupLimit
3. 註冊 onAuthStateChange → SIGNED_OUT 時跳轉 index.html
4. supabaseClient.auth.getSession() → 取得 session
5. SELECT profiles WHERE id=session.user.id → currentUserProfile
6. displayUserInfo() → 顯示暱稱/缺席/權限/訂閱狀態
7. initWishingWell() → 許願池長條圖 + 監聽器
8. fetchUserSignups() → SELECT signups WHERE user_id=me → userSignedUpChallengeIds
9. fetchChallenges() → SELECT challenges + host(profiles) + signups(profile) → challengesData
10. setupRealtimeListeners() → 頻道 room_db_changes (challenges+signups)
11. setupOnlinePresence() → 頻道 online-users (Presence)
12. startGlobalCountdown() → setInterval(1000) 倒數+戰鬥計時器
13. updateMarquee() → 排行榜 RPC 跑馬燈
```

---

## 挑戰卡片排序規則 (refreshAllChallengeCards)

```js
// 排序優先級:
// 1. status === '報名中' 置頂 (注意：比對的是 '報名中' 不是 '開放報名中')
// 2. 其餘排在下面
// 3. 同狀態內 ID 降冪 (新的先顯示)
```

---

## 卡片渲染邏輯 (renderChallenge)

### 狀態樣式
| status 值 | CSS class | 顏色 |
|-----------|-----------|------|
| '開放報名中' | status-open | 🟢 綠 |
| '已額滿' | status-full | 🔴 紅 |
| 其他（預計開放等） | status-pending | 🟠 橘 |

### 發菇者顯示
- `challenge.is_guest === true` → 顯示 `display_host_name`，前面加粉色「訪客」標籤
- `challenge.display_host_name` 有值 → 優先用這個（分身發布時）
- 否則用 `challenge.host.nickname`
- 包含 12 位數字時可點擊複製好友碼
- 分身顯示：比對 host.nickname 與 display_host_name，不同時在後面加 `(主帳號名)`

### 參加者名單
- 所有 signups 按 signed_up_at 排序
- 前 `slots` 個是正取，之後是備取
- 備取區有分隔線和「備取名單」標題
- 排名顯示 1st, 2nd, 3rd...
- 發菇者可操作：已入開關、缺席檢舉、留言編輯
- 自己可操作：留言編輯

### 操作按鈕狀態機

**發菇者自己：**
- 無報名者 → 灰色「您是發菇者」
- 有報名者 → 藍色「更新發菇狀態」(切換待發↔已發)

**已報名者（非發菇者）：**
- `is_checked_in === true` → 灰色「已入場，無法取消」
- `dispatch_status === '已發'` 且正取 → 灰色「已發車」
- `dispatch_status === '已發'` 且備取 → 仍可取消
- 其他 → 紅色「取消報名」

**未報名者：**
- `status !== '開放報名中'` 且 `status !== '報名中'` → 灰色「尚未開放」
- `signups >= slots + 2` → 灰色「已額滿」
- `daily_signup_count >= dailySignupLimit` → 灰色「本日額度已用完」
- 備取已達 3 個 → 灰色「備取額度已滿」
- 全域冷卻中 → 灰色「冷卻中 Xs」
- 正常 → 紫色「👉 報名」

### 卡片 toolbar
- 看圖 → openImageViewer(url)
- 校時 → 僅發菇者可見，打開 sync-time-modal
- 刪除 → 僅管理員
- 編輯 → 發菇者本人

---

## 報名機制 (signup_for_challenge RPC)

**呼叫方式：** `supabaseClient.rpc('signup_for_challenge', { challenge_id_to_signup })`

**邏輯流程：**
1. `FOR UPDATE` 鎖 challenge 行
2. 檢查重複報名
3. 檢查報名時間是否已到（start_time <= now()）
4. 計算 current_count
5. 備取判定：`current_count >= slots`
6. 絕對上限：`current_count >= slots + 2` → 拒絕
7. 訪客菇或備取 → 跳過懲罰檢查
8. 內部菇正取 → `(daily_signup_count + absent_score) >= daily_signup_limit` → 拒絕
9. 寫入 signups，含 signup_speed
10. 更新 profiles 的 daily/weekly/monthly 計數 + fastest_time
11. 人數達 slots → 更新 status 為 '已額滿'

---

## 取消機制 (cancel_signup_and_update_challenge RPC)

**呼叫方式：** `supabaseClient.rpc('cancel_signup_and_update_challenge', { challenge_id_to_cancel })`

**邏輯流程：**
1. 計算排名，判斷是否備取
2. 備取 → 不退額度
3. 訪客菇 → 不退額度
4. 內部菇正取 → 退還 1 次
5. DELETE signups → trigger 備份到 signup_history
6. 如果取消的是最速紀錄 → 從 signup_history 重查
7. 根據剩餘人數更新 challenge.status

---

## 全域冷卻

- 時長：3 秒
- 觸發時機：報名成功後
- 影響範圍：所有 `.signup-button`
- 實現：`globalCooldownUntil` 時間戳 + `setInterval(100ms)` 逐個按鈕更新

---

## 篩選系統

| filter | 邏輯 |
|--------|------|
| `all` | 全部顯示 |
| `imported` | card.dataset.isGuest === 'true' |
| `full` | card.dataset.status === '已額滿' |
| `signed-up` | card.dataset.isSignedUp === 'true' |
| `hosted` | card.dataset.isHosted === 'true' |

篩選是前端即時切換（set display block/none），不重新請求。

---

## Realtime 監聽

**頻道 room_db_changes：**
```js
.on('postgres_changes', { event: '*', schema: 'public', table: 'challenges' })
.on('postgres_changes', { event: '*', schema: 'public', table: 'signups' })
```
- challenges DELETE → 移除卡片
- challenges INSERT/UPDATE → reloadChallengeCard
- signups 變化 → fetchUserSignups + reloadChallengeCard

**頻道 online-users：**
```js
supabaseClient.channel('online-users', { config: { presence: { key: nickname } } })
```
- sync/join/leave → updateState → 排序暱稱 → 顯示在線人數

---

## 許願池

- 資料來源：`wish_stats` 表
- 投票機制：Edge Function `submit-wish` → RPC `submit_wish_transaction`
- 每人每日 3 票
- 六選項：巨菇、活動菇、白、紅、黃、藍
- 長條圖：寬度按票數比例，低於 6% 只顯示色塊

---

## 蘑菇顏色對照 (mushroomStyles)

```js
巨菇=cyan, 活動菇=lime, 美片菇=#ff0080
大火=red, 大紅=red, 火=red
大電=yellow, 大黃=yellow, 電=yellow
大水=blue, 大藍=blue, 水=blue
大晶=sky, 晶=sky, 大冰藍=sky
大毒=green, 毒=green
大白=white, 大紫=purple, 大粉=pink, 大灰=gray
測試=black
```

---

## 時段對照 (detailsMap)

```
宵夜=21:00~01:00, 早餐=06:00~11:00, 午餐=11:00~15:00
下午茶=15:00~17:00, 晚餐=17:00~21:00, 滿人開=人滿後發
```

---

## localStorage Keys (頁面使用)

| Key | 用途 |
|-----|------|
| `rememberedChallengeTime` | 記住發菇時間 |
| `rememberedChallengeDetails` | 記住用餐時段 |
| `rememberedCookingStyle` | 記住火侯 |
| `rememberedIdentity` | 記住發布身分 |
| `rememberedNotes` | 記住備註 |
| `bg_music_muted` | 音樂靜音狀態 |
