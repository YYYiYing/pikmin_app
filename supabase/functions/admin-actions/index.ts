// 【最終整合修復版 v8】index.ts
// 已修正重複代碼，並整理 B1/B2 權限區塊

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// 設定接收通知的中繼信箱 (Resend 測試模式請務必設為您的註冊信箱)
const RELAY_TARGET_EMAIL = 'secretsoulful@gmail.com';

// --- 核心函式：檢查蘑菇並發信 (v2.2 穩健寫入版) ---
async function checkAndSendNotification(supabase: any, resendApiKey: string, isTest = false) {
    // 1. 查詢目前「開放中」且「未額滿」的挑戰
    const { data: challenges, error: dbError } = await supabase
        .from('challenges')
        .select('*, signups(*)')
        .eq('status', '開放報名中')
        .order('id');
    
    if (dbError) throw dbError;

    const activeChallenges = challenges.filter((c: any) => {
        const signupCount = c.signups ? c.signups.length : 0;
        return signupCount < c.slots;
    });

    // 產生指紋：ID:目前人數 (例如 "2750:1|2755:3")
    const currentFingerprint = activeChallenges.map((c: any) => {
        const count = c.signups ? c.signups.length : 0;
        return `${c.id}:${count}`;
    }).join('|');

    // 如果沒有開放中的挑戰
    if (activeChallenges.length === 0 && !isTest) {
        // ★ 修正：明確寫入空字串與 value:0，作為歸零狀態
        await supabase.from('daily_settings').upsert({ 
            setting_name: 'last_signup_notify_fingerprint', 
            setting_text: '', // 空字串代表目前無名單
            setting_value: 0, 
            updated_at: new Date().toISOString()
        }, { onConflict: 'setting_name' });
        return { sent: false, message: '無開放中的挑戰，已記錄空指紋' };
    }

    // --- 狀態指紋比對 ---
    if (!isTest) {
        const { data: settingData } = await supabase
            .from('daily_settings')
            .select('setting_text')
            .eq('setting_name', 'last_signup_notify_fingerprint')
            .single();
        
        const lastFingerprint = settingData?.setting_text || '';

        if (lastFingerprint === currentFingerprint) {
            console.log('報名名單未變動，跳過通知');
            return { sent: false, message: '報名名單未變動 (與半小時前相同)，略過發信' };
        }
    }

    // 2. 組合 Email 內容 (保持不變)
    const timeString = new Date().toLocaleString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' });
    let emailHtml = `<div style="font-family: sans-serif; color: #333;"><h2 style="color: #4f46e5;">🍄 蘑菇報名快訊 [${timeString}]</h2>`;

    if (activeChallenges.length > 0) {
        emailHtml += `<p>目前統計共有 <strong>${activeChallenges.length}</strong> 朵蘑菇開放報名中(未額滿)：</p><ul style="list-style: none; padding: 0;">`;
        activeChallenges.forEach((c: any) => {
            const left = c.slots - (c.signups ? c.signups.length : 0);
            const startTime = new Date(c.start_time).toLocaleString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' });
            emailHtml += `<li style="background: #f3f4f6; margin-bottom: 10px; padding: 10px; border-radius: 8px; border-left: 4px solid #10b981;"><strong style="font-size: 1.1em;">${c.mushroom_type}</strong> (${c.details})<br><span style="color: #555;">🕒 ${startTime} 開放 | 🔥 尚缺 <strong>${left}</strong> 人</span></li>`;
        });
        emailHtml += `</ul>`;
    } else {
         emailHtml += `<p>目前沒有開放中的蘑菇 (這是手動觸發的檢查)。</p>`;
    }

    emailHtml += `<p style="margin-top: 20px;"><a href="https://yyyiying.github.io/pikmin_app/dashboard.html" style="background-color: #4f46e5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">👉 點此前往報名</a></p><p style="margin-top: 10px;"><a href="https://groups.google.com/g/mushroom_notify/membership" style="font-size: 0.85em; color: #6b7280; text-decoration: underline;">🔕 暫時不需要通知？點此前往 Google Groups 設定</a></p><p style="font-size: 0.8em; color: #888; margin-top: 20px;">本郵件由系統自動發送至群組。</p></div>`;

    // 3. 發送
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendApiKey}` },
        body: JSON.stringify({
            from: 'Mushroom Bot <onboarding@resend.dev>',
            to: [RELAY_TARGET_EMAIL], 
            subject: `[來吃喲!] ${activeChallenges.length > 0 ? activeChallenges.length + ' 朵蘑菇開放中！' : '目前無新挑戰'}`,
            html: emailHtml,
        }),
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Resend API Error (${res.status}): ${errorText}`);
    }

    // ★ 修正：發送成功後更新指紋 (含 setting_value: 0)
    if (!isTest) {
        await supabase.from('daily_settings').upsert({ 
            setting_name: 'last_signup_notify_fingerprint',
            setting_text: currentFingerprint,
            setting_value: 0, 
            updated_at: new Date().toISOString()
        }, { onConflict: 'setting_name' });
    }

    return { sent: true, message: `通知已發送 (含 ${activeChallenges.length} 筆挑戰)` };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // 初始化 Admin Client (Service Role Key)
    const adminSupabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SECRET_KEY') ?? '' 
    );

    const requestText = await req.text();
    const { action, payload } = requestText ? JSON.parse(requestText) : { action: null, payload: null };
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

    let data: unknown = null;


    // ============================================================
    // 區塊 A：系統自動化 (無需 User Auth)
    // ============================================================

    // 1. 排程發信通知 (報名通知)
    if (action === 'scheduled-email-notify') {
        if (!RESEND_API_KEY) throw new Error('缺少 RESEND_API_KEY');
        const result = await checkAndSendNotification(adminSupabaseClient, RESEND_API_KEY, false);
        return new Response(JSON.stringify({ success: true, data: result }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    }

// 2. 排程發信通知 (額滿通知 - 含用餐時段過濾 + 重複辨識)
    if (action === 'scheduled-full-notify') {
        if (!RESEND_API_KEY) throw new Error('缺少 RESEND_API_KEY');

        // A. 查詢
        const { data: fullMushrooms, error: dbError } = await adminSupabaseClient
            .from('challenges')
            .select('*, host:profiles!inner(nickname)')
            .eq('status', '已額滿')
            .neq('dispatch_status', '已發')
            .order('id'); // 排序很重要，確保指紋一致

        if (dbError) throw dbError;

        // 如果資料庫完全沒資料，直接清空指紋並結束
        if (!fullMushrooms || fullMushrooms.length === 0) {
            // ★ 修正：寫入空字串 + value:0
            await adminSupabaseClient.from('daily_settings').upsert({ 
                setting_name: 'last_full_notify_fingerprint', 
                setting_text: '',
                setting_value: 0, 
                updated_at: new Date().toISOString()
            }, { onConflict: 'setting_name' });
            return new Response(JSON.stringify({ success: true, data: { message: '目前無任何額滿蘑菇' } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
        }

        // B. 時段過濾邏輯
        const nowUTC = new Date();
        const nowTW = new Date(nowUTC.getTime() + (8 * 60 * 60 * 1000));
        const currentHour = nowTW.getUTCHours();
        
        const mealStartHours: Record<string, number[]> = {
            '早餐': [4, 10], '午餐': [11, 13], '下午茶': [14, 16], '晚餐': [17, 20], '宵夜': [21, 23]
        };

        const notifyList = fullMushrooms.filter((m: any) => {
            if (m.details === '滿人開') return true;
            
            const mushroomDateUTC = new Date(m.start_time);
            const mushroomDateTW = new Date(mushroomDateUTC.getTime() + (8 * 60 * 60 * 1000));
            
            // 日期歸零比較法
            const todayZero = new Date(nowTW.getFullYear(), nowTW.getMonth(), nowTW.getDate());
            const mushroomZero = new Date(mushroomDateTW.getFullYear(), mushroomDateTW.getMonth(), mushroomDateTW.getDate());
            const diffTime = todayZero.getTime() - mushroomZero.getTime();
            const diffDays = diffTime / (1000 * 3600 * 24);

            if (diffDays < 0) return false; // 未來
            if (diffDays >= 1) return true; // 過去 (過期強制發)

            const window = mealStartHours[m.details];
            if (!window) return true; // 未知時段預設發

            const [startH, endH] = window;
            return currentHour >= startH && currentHour <= endH;
        });

        // C. 指紋比對
        // 產生指紋：ID清單 (因為額滿名單的ID組合改變就代表有事發生)
        const currentFingerprint = notifyList.map((m: any) => m.id).join('|');

        // 讀取上次指紋
        const { data: settingData } = await adminSupabaseClient
            .from('daily_settings')
            .select('setting_text')
            .eq('setting_name', 'last_full_notify_fingerprint')
            .single();
        const lastFingerprint = settingData?.setting_text || '';

        // 如果指紋相同且名單非空，代表重複 -> 跳過
        if (currentFingerprint === lastFingerprint && notifyList.length > 0) {
            console.log('額滿名單未變動，跳過通知');
            return new Response(JSON.stringify({ 
                success: true, 
                data: { message: '額滿名單未變動 (與上次通知相同)，略過發信' } 
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
        }

        // 如果過濾後清單是空的 (例如全都被時段濾掉了)
        if (notifyList.length === 0) {
            // ★ 修正：寫入空字串 + value:0 (歸零)
            await adminSupabaseClient.from('daily_settings').upsert({ 
                setting_name: 'last_full_notify_fingerprint', 
                setting_text: '',
                setting_value: 0,
                updated_at: new Date().toISOString()
            }, { onConflict: 'setting_name' });
            return new Response(JSON.stringify({ success: true, data: { message: '檢查完成：目前無符合時段的待發蘑菇' } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
        }

        // D. 產生 Email 內容 (略，保持不變)
        const reportMap: Record<string, any[]> = {};
        notifyList.forEach((m: any) => {
            const nickname = m.host?.nickname || '未知';
            if (!reportMap[nickname]) reportMap[nickname] = [];
            reportMap[nickname].push(m);
        });

        let contentHtml = '';
        let hostIndex = 1;
        for (const [nickname, mushrooms] of Object.entries(reportMap)) {
            const listHtml = mushrooms.map((m: any) => {
                 return `<li style="margin-bottom: 4px; color: #555;">
                    ${m.mushroom_type} | <strong>${m.details}</strong> | ${m.slots}人
                 </li>`;
            }).join('');
            contentHtml += `<div style="margin-bottom: 20px; padding: 10px; background-color: #f9fafb; border-left: 4px solid #db2777; border-radius: 4px;"><h3 style="margin: 0 0 8px 0; font-size: 16px; color: #333;">第${hostIndex}位 <span style="color: #2563eb; font-weight: bold;">${nickname}</span> 提醒您發車：</h3><ul style="margin: 0; padding-left: 20px; font-size: 14px;">${listHtml}</ul></div>`;
            hostIndex++;
        }

        const emailHtml = `<div style="font-family: sans-serif; color: #333; max-width: 600px;"><h2 style="color: #db2777; border-bottom: 2px solid #db2777; padding-bottom: 10px;">🔔 蘑菇額滿發車提醒</h2><p>系統篩選報告：共有 <strong>${Object.keys(reportMap).length}</strong> 位發菇者，時間已到且額滿未發。</p>${contentHtml}<hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;"><p style="font-size: 12px; color: #999;">此郵件由系統自動生成。</p></div>`;

        // E. 寄送
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
            body: JSON.stringify({
                from: 'Mushroom Bot <onboarding@resend.dev>',
                to: [RELAY_TARGET_EMAIL], 
                subject: `[發車囉!] 共有 ${notifyList.length} 朵蘑菇待發送`,
                html: emailHtml,
            }),
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Resend API Error: ${errText}`);
        }

        // F. 發送成功後，更新指紋
        // ★ 修正：明確寫入指紋 + value:0
        await adminSupabaseClient.from('daily_settings').upsert({ 
            setting_name: 'last_full_notify_fingerprint',
            setting_text: currentFingerprint,
            setting_value: 0,
            updated_at: new Date().toISOString()
        }, { onConflict: 'setting_name' });

        return new Response(JSON.stringify({ 
            success: true, 
            data: { message: `匯總報告已發送 (含 ${notifyList.length} 朵符合時段的蘑菇)` } 
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    }

    // 3. 排程清理逾時挑戰
    if (action === 'cleanup-expired') {
        const HOURS_LIMIT = 12; 
        const cutoffTime = new Date(Date.now() - HOURS_LIMIT * 60 * 60 * 1000).toISOString();

        const { data: expiredChallenges, error: findErr } = await adminSupabaseClient
            .from('challenges')
            .select('id, image_url, mushroom_type, dispatched_at')
            .eq('dispatch_status', '已發')
            .lt('dispatched_at', cutoffTime);

        if (findErr) throw findErr;

        const deletedLog = [];
        if (expiredChallenges && expiredChallenges.length > 0) {
            for (const challenge of expiredChallenges) {
                if (challenge.image_url) {
                    try {
                        const fileName = challenge.image_url.split('/').pop();
                        if (fileName) {
                            await adminSupabaseClient.storage.from('challenge-images').remove([fileName]);
                        }
                    } catch (e) {
                        console.error(`照片路徑解析失敗 (ID: ${challenge.id}):`, e);
                    }
                }
                const { error: delErr } = await adminSupabaseClient
                    .from('challenges')
                    .delete()
                    .eq('id', challenge.id);
                
                if (!delErr) {
                    deletedLog.push(`[已刪除] ${challenge.mushroom_type} (ID: ${challenge.id})`);
                }
            }
        }

        return new Response(JSON.stringify({ 
            success: true, 
            data: { message: `清理作業完成`, deleted_count: deletedLog.length, details: deletedLog } 
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    }

    // ============================================================
    // 區塊 B：使用者驗證 (需要 Authorization Header)
    // ============================================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('缺少 Authorization Header');

    const userSupabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('PUBLIC_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await userSupabaseClient.auth.getUser();
    if (userError || !user) throw new Error('無效的使用者或 Token');


    // ============================================================
    // 區塊 B1：一般使用者功能 (B1 - General User Actions)
    // 只要是登入的使用者皆可執行，無需管理員權限
    // ============================================================

    // 1. 更新訂閱 (整合至此)
    if (action === 'update-subscription') {
        if (payload.userId !== user.id) throw new Error('權限不足 (ID 不符)');
        
        // payload.type 預設為 'signup' (報名通知), 若為 'full' 則更新額滿通知
        const column = payload.type === 'full' ? 'full_notification_email' : 'notification_email';
        
        const updateData: any = {};
        updateData[column] = payload.email;

        const { error } = await adminSupabaseClient.from('profiles').update(updateData).eq('id', user.id);
        
        if (error) throw error;
        
        const typeText = payload.type === 'full' ? '額滿通知' : '報名通知';
        return new Response(JSON.stringify({ 
            success: true, 
            data: { message: payload.email ? `${typeText}訂閱成功` : `已取消${typeText}` } 
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 2. 許願功能 (v3.1 原子操作修復版)
    if (action === 'submit-wish') {
        // 直接呼叫資料庫交易函式，所有邏輯判斷(含額度檢查)都在 SQL 中完成
        // 這樣能確保數據絕對一致，不會發生「扣了票卻沒統計」的狀況
        const { error } = await adminSupabaseClient.rpc('submit_wish_transaction', { 
            p_user_id: user.id, 
            p_types: payload.types 
        });

        if (error) {
            console.error('許願交易失敗:', error);
            // 將資料庫回傳的具體錯誤 (例如 "額度不足...") 傳回前端
            throw new Error(error.message);
        }

        return new Response(JSON.stringify({ 
            success: true, 
            data: { message: '許願成功！' } 
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 3. 使用者自行改名 (v1.0 含防撞機制)
    if (action === 'user-update-nickname') {
        const newNickname = payload.newNickname;
        
        // 基本驗證
        if (!newNickname || newNickname.length > 20) throw new Error('暱稱無效或過長');

        // 1. 計算新 Hex 信箱
        const newHexNickname = Array.from(new TextEncoder().encode(newNickname))
            .map(b => b.toString(16).padStart(2, '0')).join('');
        const newVirtualEmail = `${newHexNickname}@pikmin.sys`;

        // 2. 嘗試更新 Auth Email (這步會自動檢查唯一性)
        try {
            const { error: authUpdateErr } = await adminSupabaseClient.auth.admin.updateUserById(
                user.id, 
                { email: newVirtualEmail }
            );
            if (authUpdateErr) throw authUpdateErr;
        } catch (err: any) {
            // 捕捉特定錯誤：信箱重複 (代表暱稱被用過了)
            if (err.message.includes('already registered') || err.message.includes('duplicate')) {
                throw new Error(`暱稱「${newNickname}」已被使用，請換一個。`);
            }
            throw err; // 其他錯誤照常拋出
        }

        // 3. 更新 Profile 顯示名稱
        const { error: pErr } = await adminSupabaseClient
            .from('profiles')
            .update({ nickname: newNickname })
            .eq('id', user.id);
        
        if (pErr) throw pErr;

        // 4. 同步更新 Partners 表 (如果有的話)
        // 注意：這裡需要知道「舊暱稱」才能更新，或是前端傳過來，或是先查詢
        // 為簡化，我們嘗試查詢一次舊暱稱
        const { data: oldProfile } = await adminSupabaseClient.from('profiles').select('nickname').eq('id', user.id).single();
        if (oldProfile) {
             await adminSupabaseClient.from('partners').update({ name: newNickname }).eq('name', oldProfile.nickname);
        }

        return new Response(JSON.stringify({ 
            success: true, 
            data: { message: '暱稱修改成功！下次請用新名字登入。' } 
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // --- 新增功能：美片圖書館 Actions ---
    // 4. 發布新美片 (含計數更新)
    if (action === 'add-postcard') {
        const { uploaderId, uploaderNickname, coordinate, imageUrl, tags } = payload;
        if (user.id !== uploaderId) throw new Error('身分驗證失敗');

        // A. 寫入 postcards 表
        const { data: newCard, error: insertErr } = await adminSupabaseClient
            .from('postcards')
            .insert({
                uploader_id: uploaderId,
                uploader_nickname: uploaderNickname,
                coordinate: coordinate,
                image_url: imageUrl,
                tags: tags,
                likes: 0
            })
            .select()
            .single();

        if (insertErr) throw insertErr;

        // B. 更新該使用者的計數 (Total / Week / Month)
        // 使用 RPC 或直接 SQL update (這裡用直接 update 簡化)
        // 注意：需先讀取當前值再 +1 會有併發風險，建議用 rpc increment，這裡為示範直接 update
        await adminSupabaseClient.rpc('increment_postcard_count', { user_id: uploaderId });
        
        return new Response(JSON.stringify({ success: true, data: newCard }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 5. 刪除美片 (含計數扣除)
    if (action === 'delete-postcard') {
        const { postcardId } = payload;
        
        // 查驗權限
        const { data: card } = await adminSupabaseClient.from('postcards').select('uploader_id, image_url').eq('id', postcardId).single();
        if (!card) throw new Error('找不到該美片');
        
        const { data: operatorProfile } = await adminSupabaseClient.from('profiles').select('role').eq('id', user.id).single();
        const isAdmin = operatorProfile?.role === '管理者';
        
        if (card.uploader_id !== user.id && !isAdmin) {
            throw new Error('權限不足，您不是發現者也不是管理員');
        }

        // A. 刪除圖片 (Storage)
        if (card.image_url) {
            try {
                const fileName = card.image_url.split('/').pop();
                if (fileName) await adminSupabaseClient.storage.from('postcard-images').remove([fileName]);
            } catch (e) { console.error('圖片刪除失敗', e); }
        }

        // B. 刪除資料庫紀錄
        const { error: delErr } = await adminSupabaseClient.from('postcards').delete().eq('id', postcardId);
        if (delErr) throw delErr;

        // C. 扣除計數 (僅當該卡片有歸屬者時)
        if (card.uploader_id) {
            await adminSupabaseClient.rpc('decrement_postcard_count', { user_id: card.uploader_id });
        }

        return new Response(JSON.stringify({ success: true, data: { message: '刪除成功' } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 6. 編輯美片 (支援換圖)
    if (action === 'edit-postcard') {
        const { postcardId, coordinate, tags, imageUrl } = payload;
        
        // 1. 查出舊資料 (驗證權限 + 取得舊圖路徑用)
        const { data: oldCard } = await adminSupabaseClient.from('postcards').select('uploader_id, image_url').eq('id', postcardId).single();
        if (!oldCard) throw new Error('找不到該美片');

        // 驗證權限
        const { data: operatorProfile } = await adminSupabaseClient.from('profiles').select('role').eq('id', user.id).single();
        const isAdmin = operatorProfile?.role === '管理者';

        if (oldCard.uploader_id !== user.id && !isAdmin) throw new Error('權限不足');

        // 2. 準備更新資料
        const updateData: any = { coordinate, tags };
        if (imageUrl) {
            updateData.image_url = imageUrl; // 如果有新圖，才更新欄位
        }

        // 3. 執行更新
        const { error } = await adminSupabaseClient
            .from('postcards')
            .update(updateData)
            .eq('id', postcardId);

        if (error) throw error;

        // 4. ★ 關鍵：如果有換圖 (imageUrl 存在)，且更新成功，就刪除舊圖
        if (imageUrl && oldCard.image_url) {
            try {
                const oldFileName = oldCard.image_url.split('/').pop();
                // 簡單防呆：確保新舊檔名不同才刪 (雖然檔名有時間戳記通常不同，但以防萬一)
                const newFileName = imageUrl.split('/').pop();
                
                if (oldFileName && oldFileName !== newFileName) {
                    await adminSupabaseClient.storage.from('postcard-images').remove([oldFileName]);
                    console.log(`[Postcard] 舊圖已刪除: ${oldFileName}`);
                }
            } catch (e) {
                console.error('舊圖刪除失敗 (不影響更新):', e);
            }
        }

        return new Response(JSON.stringify({ success: true, data: { message: '更新成功' } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 7. 按讚/取消讚 (Toggle Like)
    if (action === 'toggle-postcard-like') {
        const { postcardId } = payload;
        const userId = user.id;

        // 檢查是否按過讚
        const { data: existingLike } = await adminSupabaseClient
            .from('postcard_likes')
            .select('*')
            .eq('postcard_id', postcardId)
            .eq('user_id', userId)
            .single();

        let finalLikes = 0;

        if (existingLike) {
            // 取消讚
            await adminSupabaseClient.from('postcard_likes').delete().eq('postcard_id', postcardId).eq('user_id', userId);
            // 減少計數
            const { data: p } = await adminSupabaseClient.rpc('update_postcard_likes', { p_id: postcardId, p_delta: -1 });
            finalLikes = p;
        } else {
            // 新增讚
            await adminSupabaseClient.from('postcard_likes').insert({ postcard_id: postcardId, user_id: userId });
            // 增加計數
            const { data: p } = await adminSupabaseClient.rpc('update_postcard_likes', { p_id: postcardId, p_delta: 1 });
            finalLikes = p;
        }

        return new Response(JSON.stringify({ success: true, data: { likes: finalLikes, liked: !existingLike } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    
    // ============================================================
    // 區塊 B2：管理員專屬功能 (B2 - Admin Only Actions)
    // 必須檢查 role === '管理者'，否則回傳 403
    // ============================================================
    
    const { data: profile } = await adminSupabaseClient.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== '管理者') {
        return new Response(JSON.stringify({ error: '權限不足 (非管理員)' }), { status: 403, headers: corsHeaders });
    }

    // --- 管理員操作 Switch ---
    switch (action) {
        
        // 取得使用者列表 (含最後登入時間)
        case 'list-users-with-details':
            const { data: profiles, error: profilesError } = await adminSupabaseClient.from('profiles').select('*');
            if (profilesError) throw profilesError;
            if (!profiles || profiles.length === 0) { data = { users: [] }; break; }
            
            const userIds = profiles.map((p: any) => p.id);
            const { data: authData, error: rpcError } = await adminSupabaseClient
                .rpc('get_users_signin_data', { user_ids: userIds });
            
            if (rpcError) { console.error("RPC call failed:", rpcError); throw rpcError; }

            const authMap = new Map(authData.map((u: any) => [u.id, u.last_sign_in_at]));
            const combinedUsers = profiles.map((profile: any) => ({
                ...profile,
                last_sign_in_at: authMap.get(profile.id) || null
            }));
            data = { users: combinedUsers };
            break;

        case 'send-test-email':
            if (!RESEND_API_KEY) throw new Error('缺少 RESEND_API_KEY');
            const testRes = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
                body: JSON.stringify({
                    from: 'Mushroom Bot <onboarding@resend.dev>', 
                    to: [RELAY_TARGET_EMAIL],
                    subject: `[測試] 蘑菇通知連線測試`,
                    html: `<p>這是一封測試信。</p>`,
                }),
            });
            if (!testRes.ok) throw new Error(await testRes.text());
            data = { message: '測試信已發送' };
            break;

        case 'trigger-check-now':
            if (!RESEND_API_KEY) throw new Error('缺少 RESEND_API_KEY');
            data = await checkAndSendNotification(adminSupabaseClient, RESEND_API_KEY, true);
            break;

        case 'get-subscriber-emails': 
            const { data: subscribers, error: subErr } = await adminSupabaseClient.from('profiles').select('notification_email').not('notification_email', 'is', null).order('notification_email');
            if (subErr) throw subErr;
            data = { emails: subscribers.map((p: any) => p.notification_email).filter((e: string) => e && e.includes('@')) };
            break;

        case 'delete-challenge':
            if (!payload.challengeId) throw new Error('缺少 challengeId');
            const { data: challengeData } = await adminSupabaseClient
                .from('challenges')
                .select('image_url')
                .eq('id', payload.challengeId)
                .single();

            if (challengeData && challengeData.image_url) {
                try {
                    const fileName = challengeData.image_url.split('/').pop();
                    if (fileName) {
                        await adminSupabaseClient.storage.from('challenge-images').remove([fileName]);
                    }
                } catch (e) {
                    console.error('圖片刪除失敗:', e);
                }
            }
            const { error: delErr } = await adminSupabaseClient.from('challenges').delete().eq('id', payload.challengeId);
            if (delErr) throw delErr;
            data = { message: '刪除成功' };
            break;

        case 'create-user':
             // ★ 修改：改用 Hex 編碼生成虛擬信箱，確保每個字元(含特殊符號)都能區分，解決撞名問題
             const hexNickname = Array.from(new TextEncoder().encode(payload.nickname))
                .map(b => b.toString(16).padStart(2, '0')).join('');
             
             const virtualEmail = `${hexNickname}@pikmin.sys`;
             
             // 以下保持不變
             const { data: created, error: createErr } = await adminSupabaseClient.auth.admin.createUser({ email: virtualEmail, password: payload.password, email_confirm: true });
             if (createErr) throw createErr;
             if (created.user) {
                  const { error: profileErr } = await adminSupabaseClient.from('profiles').insert({ id: created.user.id, nickname: payload.nickname, role: payload.role });
                  if (profileErr) { await adminSupabaseClient.auth.admin.deleteUser(created.user.id); throw new Error(`建立 Profile 失敗: ${profileErr.message}`); }
                  data = created;
             }
             break;
             
        case 'update-user-role': 
            ({ data } = await adminSupabaseClient.from('profiles').update({ role: payload.role }).eq('id', payload.userId).select()); 
            break;
            
        case 'reset-user-password': 
            ({ data } = await adminSupabaseClient.auth.admin.updateUserById(payload.userId, { password: payload.password })); 
            break;
            
        case 'delete-user': 
            if (!payload.userId) throw new Error('缺少 userId'); 
            ({ data } = await adminSupabaseClient.auth.admin.deleteUser(payload.userId)); 
            break;
            
        // ★ 修改：更新暱稱時，同步更新 Auth 表的虛擬信箱，確保登入邏輯一致
        case 'update-user-nickname': 
            // 1. 先計算新暱稱對應的 Hex 虛擬信箱
            const newHexNickname = Array.from(new TextEncoder().encode(payload.newNickname))
                .map(b => b.toString(16).padStart(2, '0')).join('');
            const newVirtualEmail = `${newHexNickname}@pikmin.sys`;

            // 2. 更新 Supabase Auth (這步最關鍵，讓使用者能用新名字登入)
            // 注意：這會讓該使用者變成「新制 (Hex) 帳號」，這很好，統一規格
            const { error: authUpdateErr } = await adminSupabaseClient.auth.admin.updateUserById(
                payload.userId, 
                { email: newVirtualEmail }
            );
            
            if (authUpdateErr) throw new Error(`Auth 更新失敗: ${authUpdateErr.message}`);

            // 3. 更新 Profiles 表 (顯示用)
            const { error: pErr } = await adminSupabaseClient
                .from('profiles')
                .update({ nickname: payload.newNickname })
                .eq('id', payload.userId);
            
            if (pErr) throw pErr;

            // 4. 更新 Partners 表 (如果有對應的話)
            await adminSupabaseClient
                .from('partners')
                .update({ name: payload.newNickname })
                .eq('name', payload.oldNickname);
            
            break;
            
        case 'get-daily-limit': 
            ({ data } = await adminSupabaseClient.from('daily_settings').select('setting_value').eq('setting_name', 'daily_signup_limit').single()); 
            break;
            
        case 'set-daily-limit': 
            ({ data } = await adminSupabaseClient.from('daily_settings').update({ setting_value: payload.value, updated_at: new Date().toISOString() }).eq('setting_name', 'daily_signup_limit').select().single()); 
            break;
            
        case 'ping': 
            break;
            
        default: throw new Error(`未知的操作: ${action}`);
    }

    return new Response(JSON.stringify({ success: true, data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});