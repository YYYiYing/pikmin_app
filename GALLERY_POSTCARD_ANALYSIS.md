# 美片藝廊 vs 美片圖書館 — 功能分析

> 分析日期：2026-07-21
> gallery.html (1169行) vs postcard.html (905行)

## 一、定位差異一句話

| | gallery.html (藝廊) | postcard.html (圖書館) |
|------|------|------|
| **性質** | 公開曝光的市集 | 私人珍藏的保險箱 |
| **使用者** | 任何人（含訪客） | 會員（需登入） |
| **資料表** | `guest_postcards` | `postcards` |
| **身分識別** | IP 指紋 + 訪客暱稱/好友碼 | Supabase Auth JWT |

---

## 二、資料流與後端對比

| 功能 | gallery.html | postcard.html |
|------|-------------|-------------|
| **讀取資料** | `list-guest-postcards` (Edge Function) | `supabaseClient.from('postcards').select('*')` (直接查詢) |
| **新增** | `add-guest-postcard` (座標去重) | `add-postcard` (座標去重) |
| **編輯** | `edit-guest-postcard` (IP/管理員驗證) | `edit-postcard` (本人/管理員驗證，含舊圖清理) |
| **刪除** | `delete-guest-postcard` | `delete-postcard` |
| **按讚** | `toggle-guest-postcard-like` (IP 指紋去重) | `toggle-postcard-like` (user_id，獨立表 `postcard_likes`) |
| **絕版** | `toggle-guest-postcard-obsolete` | `toggle-postcard-obsolete` |
| **反查地址** | `reverse-geocode` (Nominatim API proxy) | 同左 |
| **圖片桶** | `guest-postcard-images` | `postcard-images` |
| **CDN** | `getCdnUrl()` → `pikmin-cdn.secretsoulful.workers.dev` | 同左 |

---

## 三、Auth 與權限機制

### gallery.html（三層身分判定）
```
1. Supabase Auth session → [村民] 或 [管理員] 顯示
2. localStorage guest_nick + guest_code → [訪客] 顯示
3. 無登入 + 無訪客資料 → 提示前往大廳設定
```

**發佈時身分優先序：**
```
訪客資料 (guest.html 設定) > 會員暱稱 (從 nickname+12碼 拆解) > 拒絕發布
```

**擁有權判定：**
```
IP 指紋相同 OR (nickname + friend_code 相同) → 自己的卡
管理員角色 → 可以編輯/刪除任何卡
```

**system_import 保護：** `ip_fingerprint = 'system_import'` 的美片（由 migration.html 遷入）無法被一般訪客刪除。

### postcard.html（單純會員制）
```
無 session → alert + 跳轉 login
有 session → 查 profile (role) → 載入卡片
```

**擁有權判定：**
```
uploader_id = currentUser.id OR role = '管理者'
```

---

## 四、共用功能（程式碼幾乎相同）

| 功能 | 共用度 | 差異 |
|------|--------|------|
| `formatCoordinateString()` | 95% | 一模一樣（Google Maps 網址解析 + DMS 轉換） |
| `autoFillLocation()` | 95% | 僅 toast 位置不同 |
| `compressImage()` | 100% | CompressorJS 完全一樣 (quality 0.6, max 1600px) |
| 下拉選單機制 | 100% | `setupDropdown()` + 自訂 dropdown-container CSS |
| 分頁系統 | 100% | 24 張/頁，`changePage()` / `jumpToPage()` |
| 圖片檢視器 | 95% | Modal + CDN URL 替換 |
| toast 通知 | 90% | 樣式相同，z-index 略有不同 |
| 座標複製 | 100% | `copyText()` → `navigator.clipboard` |
| 貼上座標按鈕 | 100% | `paste-coord-btn` → `handleCoordInput()` |
| 標籤篩選器 | 95% | 皆顯示前 6 個標籤 +「更多」+「絕版區」 |
| 國家/地區/細項篩選 | 100% | 三角下拉 + `fillSelect()` |
| 絕版切換 | 90% | gallery 支援管理員，postcard 支援管理員 |

---

## 五、UI 差異

| 項目 | gallery.html | postcard.html |
|------|-------------|-------------|
| **主題色** | 紫 (violet/purple) | 粉 (pink/rose) |
| **導回按鈕** | `handleBack()` (自訂函式) | `history.back()` |
| **卡片 author 顯示** | `c.nickname` (存於 guest_postcards) | `p.uploader_nickname` (存於 postcards) |
| **按鈕文字** | 絕版區切換：🚫 / ✅上架 | 同左 |
| **絕版視覺** | grayscale + opacity-60 + 紅色浮水印 | grayscale + opacity-75 + 紅色浮水印 |
| **座標複製按鈕** | 僅 📋 圖示 | 📋 複製（含文字） |
| **標籤顏色** | 預設灰色底 | 預設灰色底 |
| **CDN 重複引入** | ❌ 無 | ⚠️ Tailwind + Supabase 重複引入(第9-12行重複) |

---

## 六、Edge Function 層的關係

兩個表在 Edge Function 中互有關聯：

| 功能 | 說明 |
|------|------|
| **座標去重** | 僅檢查 `guest_postcards` 自身表 | 僅檢查 `postcards` 自身表 |
| **按讚** | `toggle-guest-postcard-like` (IP 指紋去重) | `toggle-postcard-like` (user_id，獨立表 `postcard_likes`) |
| **圖片清理** | 編輯/刪除時手動刪除 Storage 舊圖，`cleanup-expired` cron 也會清理孤兒圖片 |
| **migration.html** | 將 `postcards` 表的卡遷移到 `guest_postcards`，設 `ip_fingerprint = 'system_import'` |
| **dedupe.html** | 跨表掃描兩邊的座標重複，支援模糊比對 |

---

## 七、潛在問題與建議

| # | 問題 | 建議 |
|---|------|------|
| 1 | postcard.html 重複引入 Tailwind + Supabase（第9-12行） | 刪除重複的 script 標籤 |
| 2 | 兩個檔案共用 90% 的座標格式化 + 反查邏輯 | 若有 build system 可抽成共用模組；現狀無 build system 維持各自實作 |
| 3 | gallery.html 用 `history.back()` 無效時無 fallback | 可參考 postcard 直接導向首頁 |
| 4 | 兩個表分開維護，座標去重邏輯分散在 Edge Function 各 action | 重構時可統一去重函式 |
| 5 | `postcard_likes` 獨立於 `postcards` 表 | 設計合理，避免 likes count 與實際記錄不同步 |

---

## 八、資料表欄位對比

| 欄位 | guest_postcards | postcards |
|------|:---:|:---:|
| `uploader_nickname` | — | ✅ |
| `uploader_id` | — | ✅ |
| `nickname` (發布者) | ✅ | — |
| `friend_code` | ✅ | — |
| `ip_fingerprint` | ✅ | — |
| `coordinate` | ✅ | ✅ |
| `image_url` | ✅ | ✅ |
| `country` / `region` / `area` | ✅ | ✅ |
| `tags` (text[]) | ✅ | ✅ |
| `likes` (int) | ✅ | ✅ |
| `is_obsolete` | ✅ | ✅ |
| `is_liked` (前端計算) | ✅ (IP 查詢) | ✅ (`postcard_likes` 查詢) |
