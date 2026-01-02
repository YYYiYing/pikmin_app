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
    // 區塊 A：系統自動化 與 訪客公開功能 (無需 User Auth)
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

    // 3. 排程清理逾時挑戰 (整合版：內部菇10hr + 訪客菇6hr + 圖片清理)
    if (action === 'cleanup-expired') {
        const now = Date.now();
        const deletedLog = [];

        // A. 定義時間門檻
        // 內部菇：已發車超過 10 小時
        const internalCutoff = new Date(now - 10 * 60 * 60 * 1000).toISOString();
        // 訪客菇：開放時間超過 6 小時
        const guestCutoff = new Date(now - 6 * 60 * 60 * 1000).toISOString();

        // B1. 查詢逾時內部菇
        const { data: internalList, error: err1 } = await adminSupabaseClient
            .from('challenges')
            .select('id, image_url, mushroom_type, is_guest')
            .eq('dispatch_status', '已發')
            .lt('dispatched_at', internalCutoff);
        
        if (err1) throw err1;

        // B2. 查詢逾時訪客菇
        const { data: guestList, error: err2 } = await adminSupabaseClient
            .from('challenges')
            .select('id, image_url, mushroom_type, is_guest')
            .eq('is_guest', true)
            .lt('start_time', guestCutoff);

        if (err2) throw err2;

        // C. 合併清單
        const allToDelete = [
            ...(internalList || []),
            ...(guestList || [])
        ];

        // D. 執行刪除與圖片清理
        if (allToDelete.length > 0) {
            for (const challenge of allToDelete) {
                // 1. 刪除圖片 (濾除 URL 參數)
                if (challenge.image_url) {
                    try {
                        const fileName = challenge.image_url.split('/').pop()?.split('?')[0];
                        if (fileName) {
                            await adminSupabaseClient.storage.from('challenge-images').remove([fileName]);
                        }
                    } catch (e) {
                        console.error(`圖片清理失敗 (ID: ${challenge.id}):`, e);
                    }
                }

                // 2. 刪除紀錄
                const { error: delErr } = await adminSupabaseClient
                    .from('challenges')
                    .delete()
                    .eq('id', challenge.id);
                
                // 3. 紀錄 Log
                if (!delErr) {
                    const typeLabel = challenge.is_guest ? '[訪客菇]' : '[內部菇]';
                    deletedLog.push(`${typeLabel} 已刪除: ${challenge.mushroom_type} (ID: ${challenge.id})`);
                }
            }
        }

        return new Response(JSON.stringify({ 
            success: true, 
            data: { 
                message: `清理作業完成`, 
                deleted_count: deletedLog.length, 
                details: deletedLog 
            } 
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    }

    // ★ 新增：取得首頁數據 (全類別 Top 3)
    if (action === 'get-radar-home-data') {
        const authHeader = req.headers.get('Authorization');

        // 呼叫 SQL RPC
        const { data, error } = await adminSupabaseClient.rpc('get_radar_top_posts', { p_limit: 3 });

        if (error) throw error;

        // 處理投票狀態 (為了讓首頁也能顯示亮燈)
        // (這裡重複使用了 get-radar-posts 的邏輯，建議未來可抽成共用函式，這裡先直接寫)
        let userVotes: any[] = [];
        const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
        
        if (authHeader) {
             const tempClient = createClient(
                  Deno.env.get('SUPABASE_URL') ?? '',
                  Deno.env.get('PUBLIC_KEY') ?? '',
                  { global: { headers: { Authorization: authHeader } } }
             );
             const { data: uData } = await tempClient.auth.getUser();
             if (uData?.user) {
                 const { data: votes } = await adminSupabaseClient.from('radar_votes').select('post_id, vote_type').in('post_id', data.map((p:any)=>p.id)).eq('user_id', uData.user.id);
                 userVotes = votes || [];
             }
        } 
        
        if (userVotes.length === 0 && clientIp !== 'unknown') {
            const encoder = new TextEncoder();
            const d = encoder.encode(clientIp + 'SALT_2025');
            const hashBuffer = await crypto.subtle.digest('SHA-1', d);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const fingerprint = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 6);
            const { data: votes } = await adminSupabaseClient.from('radar_votes').select('post_id, vote_type').in('post_id', data.map((p:any)=>p.id)).eq('ip_fingerprint', fingerprint);
            userVotes = votes || [];
        }

        const voteMap: Record<string, string> = {}; 
        userVotes.forEach((v: any) => voteMap[v.post_id] = v.vote_type);

        const result = data.map((p: any) => ({ ...p, my_vote: voteMap[p.id] || null }));
        return new Response(JSON.stringify({ success: true, data: result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 反查地址 Proxy (解決前端 CORS 問題)
        if (action === 'reverse-geocode') {
            const { lat, lng } = payload;
            
            // 必須帶上 User-Agent，否則 OpenStreetMap 會回傳 403 Forbidden
            const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=zh-TW`;
            
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Pikmin-Mushroom-Radar/1.0 (contact: secretsoulful@gmail.com)' 
                }
            });

            if (!response.ok) {
                console.error('Nominatim API Error:', response.status);
                throw new Error('無法取得地址資訊');
            }

            const data = await response.json();
            
            return new Response(JSON.stringify({ success: true, data: data }), { 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200 
            });
        }

    // ==========================================
    // ▼▼▼ 美片藝廊 (Guest Gallery) 功能區 ▼▼▼
    // ==========================================

    // 1. 讀取藝廊列表 (含按讚狀態檢查)
    if (action === 'list-guest-postcards') {
        const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
        
        // 計算 IP 指紋 (用於判斷是否按過讚)
        let fingerprint = 'unknown';
        if (clientIp !== 'unknown') {
            const encoder = new TextEncoder();
            const d = encoder.encode(clientIp + 'SALT_2025');
            const hashBuffer = await crypto.subtle.digest('SHA-1', d);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            fingerprint = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 6);
        }

        // 讀取所有卡片
        const { data: cards, error } = await adminSupabaseClient
            .from('guest_postcards')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw new Error(error.message);

        // 讀取該 IP 的按讚紀錄
        const { data: myLikes } = await adminSupabaseClient
            .from('guest_postcard_likes')
            .select('postcard_id')
            .eq('ip_fingerprint', fingerprint);
        
        const likedSet = new Set(myLikes ? myLikes.map((l: any) => l.postcard_id) : []);

        // 組合回傳資料
        const result = cards.map((c: any) => ({
            ...c,
            isLiked: likedSet.has(c.id)
        }));

        return new Response(JSON.stringify({ success: true, data: result, ip_fingerprint: fingerprint }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 2. 發布訪客美片 (含座標重複檢查)
    if (action === 'add-guest-postcard') {
        const { nickname, friendCode, coordinate, country, region, area, imageUrl, tags } = payload;
        
        // ★ 檢查座標是否重複
        const { data: existing } = await adminSupabaseClient
            .from('guest_postcards')
            .select('id')
            .eq('coordinate', coordinate)
            .maybeSingle();

        if (existing) {
            return new Response(JSON.stringify({ 
                success: false, 
                message: '此座標已經有其他訪客分享過美片囉！' 
            }), { 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200 
            });
        }

        // 獲取 IP 指紋
        const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
        let fingerprint = 'unknown';
        if (clientIp !== 'unknown') {
            const encoder = new TextEncoder();
            const d = encoder.encode(clientIp + 'SALT_2025');
            const hashBuffer = await crypto.subtle.digest('SHA-1', d);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            fingerprint = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 6);
        }

        // 寫入資料
        const { data, error } = await adminSupabaseClient
            .from('guest_postcards')
            .insert({
                nickname,
                friend_code: friendCode,
                ip_fingerprint: fingerprint,
                coordinate,
                country: country || '',
                region: region || '',
                area: area || '',
                image_url: imageUrl,
                tags: tags || [],
                likes: 0
            })
            .select()
            .single();

        if (error) throw error;
        return new Response(JSON.stringify({ success: true, data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 3. 編輯訪客美片 (支援：本人 IP/Code 驗證 或 管理員 Token 驗證)
    if (action === 'edit-guest-postcard') {
        const { id, nickname, friendCode, coordinate, country, region, area, imageUrl, tags } = payload;
        const authHeader = req.headers.get('Authorization'); // ★ 取得 Token

        // 1. 查舊資料
        const { data: oldCard } = await adminSupabaseClient.from('guest_postcards').select('*').eq('id', id).single();
        if (!oldCard) throw new Error('找不到該美片');

        // 2. 驗證權限 (層層關卡)
        let hasPermission = false;

        // 關卡 A: 管理員
        if (authHeader) {
            try {
                const tempClient = createClient(
                    Deno.env.get('SUPABASE_URL') ?? '',
                    Deno.env.get('PUBLIC_KEY') ?? '',
                    { global: { headers: { Authorization: authHeader } } }
                );
                const { data: { user } } = await tempClient.auth.getUser();
                if (user) {
                    const { data: profile } = await adminSupabaseClient
                        .from('profiles')
                        .select('role')
                        .eq('id', user.id)
                        .single();
                    if (profile?.role === '管理者') hasPermission = true;
                }
            } catch (e) {}
        }

        // 關卡 B: 本人 (若非管理員)
        if (!hasPermission) {
            const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
            let fingerprint = 'unknown';
            // ... (計算指紋邏輯同前) ...
            if (clientIp !== 'unknown') {
                const encoder = new TextEncoder();
                const d = encoder.encode(clientIp + 'SALT_2025');
                const hashBuffer = await crypto.subtle.digest('SHA-1', d);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                fingerprint = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 6);
            }

            const isIpMatch = oldCard.ip_fingerprint === fingerprint;
            const isUserMatch = (oldCard.friend_code === friendCode && oldCard.nickname === nickname);
            
            if (isIpMatch || isUserMatch) hasPermission = true;
        }

        if (!hasPermission) throw new Error('權限不足：您無法編輯此卡片');

        // 3. 更新資料
        const updateData: any = { coordinate, tags, country, region, area };
        if (imageUrl) updateData.image_url = imageUrl;

        const { error } = await adminSupabaseClient
            .from('guest_postcards')
            .update(updateData)
            .eq('id', id);

        if (error) throw error;

        // 4. 清理舊圖
        if (imageUrl && oldCard.image_url && oldCard.image_url !== imageUrl) {
            try {
                const oldFileName = oldCard.image_url.split('/').pop()?.split('?')[0];
                if (oldFileName) {
                    await adminSupabaseClient.storage.from('guest-postcard-images').remove([oldFileName]);
                }
            } catch (e) { console.error('舊圖清理失敗', e); }
        }

        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 4. 刪除訪客美片 (支援：本人 IP/Code 驗證 或 管理員 Token 驗證)
    if (action === 'delete-guest-postcard') {
        const { id, nickname, friendCode } = payload;
        const authHeader = req.headers.get('Authorization'); // 取得登入 Token

        // 1. 查舊資料
        const { data: oldCard } = await adminSupabaseClient.from('guest_postcards').select('*').eq('id', id).single();
        if (!oldCard) throw new Error('找不到該美片');

        // 2. 驗證權限 (層層關卡)
        let hasPermission = false;

        // 關卡 A: 驗證是否為管理員 (最高權限)
        if (authHeader) {
            try {
                // 建立一個臨時客戶端來驗證 Token
                const tempClient = createClient(
                    Deno.env.get('SUPABASE_URL') ?? '',
                    Deno.env.get('PUBLIC_KEY') ?? '',
                    { global: { headers: { Authorization: authHeader } } }
                );
                const { data: { user } } = await tempClient.auth.getUser();
                
                if (user) {
                    // 查 Profile 確認角色
                    const { data: profile } = await adminSupabaseClient
                        .from('profiles')
                        .select('role')
                        .eq('id', user.id)
                        .single();
                    
                    if (profile?.role === '管理者') {
                        hasPermission = true; // 管理員通行
                    }
                }
            } catch (e) {
                console.error('Admin check failed:', e);
            }
        }

        // 關卡 B: 若非管理員，驗證是否為本人 (IP 或 暱稱+好友碼)
        if (!hasPermission) {
            const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
            let fingerprint = 'unknown';
            if (clientIp !== 'unknown') {
                const encoder = new TextEncoder();
                const d = encoder.encode(clientIp + 'SALT_2025');
                const hashBuffer = await crypto.subtle.digest('SHA-1', d);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                fingerprint = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 6);
            }

            const isIpMatch = oldCard.ip_fingerprint === fingerprint;
            const isUserMatch = (oldCard.friend_code === friendCode && oldCard.nickname === nickname);

            if (isIpMatch || isUserMatch) {
                hasPermission = true;
            }
        }

        // 最終判決
        if (!hasPermission) {
             throw new Error('權限不足：您無法刪除此卡片');
        }

        // 3. 刪除圖片
        // 安全機制：只有當這張卡片「不是」系統匯入時，才執行檔案刪除
        // 保護「美片圖書館」原本的圖片不被刪除
        if (oldCard.image_url && oldCard.ip_fingerprint !== 'system_import') {
            try {
                // 嘗試從網址解析檔名
                const fileName = oldCard.image_url.split('/').pop()?.split('?')[0];
                if (fileName) {
                    // 只針對「訪客上傳區 (guest-postcard-images)」進行刪除
                    await adminSupabaseClient.storage.from('guest-postcard-images').remove([fileName]);
                }
            } catch (e) { 
                console.error('圖片刪除失敗 (但不影響資料刪除)', e); 
            }
        }

        // 4. 刪除資料
        const { error } = await adminSupabaseClient.from('guest_postcards').delete().eq('id', id);
        if (error) throw error;

        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 5. 訪客美片點讚
    if (action === 'toggle-guest-postcard-like') {
        const { postcardId } = payload;
        const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
        
        let fingerprint = 'unknown';
        if (clientIp !== 'unknown') {
            const encoder = new TextEncoder();
            const d = encoder.encode(clientIp + 'SALT_2025');
            const hashBuffer = await crypto.subtle.digest('SHA-1', d);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            fingerprint = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 6);
        }

        // 檢查是否讚過
        const { data: existing } = await adminSupabaseClient
            .from('guest_postcard_likes')
            .select('id')
            .eq('postcard_id', postcardId)
            .eq('ip_fingerprint', fingerprint)
            .maybeSingle();

        let delta = 0;
        let isLiked = false;

        if (existing) {
            await adminSupabaseClient.from('guest_postcard_likes').delete().eq('id', existing.id);
            delta = -1;
            isLiked = false;
        } else {
            await adminSupabaseClient.from('guest_postcard_likes').insert({ postcard_id: postcardId, ip_fingerprint: fingerprint });
            delta = 1;
            isLiked = true;
        }

        // 更新計數
        const { data: card } = await adminSupabaseClient.from('guest_postcards').select('likes').eq('id', postcardId).single();
        const newCount = (card?.likes || 0) + delta;
        await adminSupabaseClient.from('guest_postcards').update({ likes: newCount }).eq('id', postcardId);

        return new Response(JSON.stringify({ success: true, data: { likes: newCount, isLiked } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 6. 訪客回報/取消絕版
    if (action === 'toggle-guest-postcard-obsolete') {
        const { postcardId } = payload;
        
        // 1. 查詢目前狀態
        const { data: card, error: fetchErr } = await adminSupabaseClient
            .from('guest_postcards')
            .select('is_obsolete')
            .eq('id', postcardId)
            .single();
            
        if (fetchErr || !card) throw new Error('找不到該美片');

        // 2. 切換狀態
        const newStatus = !card.is_obsolete;

        const { error: updateErr } = await adminSupabaseClient
            .from('guest_postcards')
            .update({ is_obsolete: newStatus })
            .eq('id', postcardId);

        if (updateErr) throw updateErr;

        return new Response(JSON.stringify({ 
            success: true, 
            data: { 
                is_obsolete: newStatus,
                message: newStatus ? '已回報為絕版' : '已恢復為上架狀態'
            } 
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 8. [管理員專用] 搬家工具：從美片圖書館轉移到美片藝廊
    if (action === 'migrate-postcards') {
        const { ids } = payload; // 接收前端傳來的 ID 陣列
        const authHeader = req.headers.get('Authorization');

        // --- 1. 嚴格驗證管理員權限 ---
        let isAdmin = false;
        if (authHeader) {
            try {
                const tempClient = createClient(
                    Deno.env.get('SUPABASE_URL') ?? '',
                    Deno.env.get('PUBLIC_KEY') ?? '',
                    { global: { headers: { Authorization: authHeader } } }
                );
                const { data: { user } } = await tempClient.auth.getUser();
                if (user) {
                    const { data: profile } = await adminSupabaseClient
                        .from('profiles')
                        .select('role')
                        .eq('id', user.id)
                        .single();
                    if (profile?.role === '管理者') isAdmin = true;
                }
            } catch (e) {}
        }

        if (!isAdmin) throw new Error('權限不足：僅管理員可執行轉移操作');
        if (!ids || ids.length === 0) throw new Error('未選擇任何項目');

        // --- 2. 讀取來源資料 (美片圖書館 public.postcards) ---
        const { data: sourceCards, error: fetchError } = await adminSupabaseClient
            .from('postcards')
            .select('*')
            .in('id', ids);

        if (fetchError) throw fetchError;
        if (!sourceCards || sourceCards.length === 0) throw new Error('找不到指定的原始資料');

        // --- 3. 轉換格式並寫入目標 (美片藝廊 public.guest_postcards) ---
        const newCards = sourceCards.map((card: any) => ({
            nickname: card.uploader_nickname || '匿名', // 轉移暱稱
            friend_code: '000000000000',               // 預設官方好友碼
            ip_fingerprint: 'system_import',           // ★ 關鍵：設定為系統匯入 (觸發您的刪除保護機制)
            coordinate: card.coordinate,
            image_url: card.image_url,                 // 複製連結 (不搬運實體檔案)
            tags: card.tags,
            likes: card.likes || 0,                    // 保留按讚數
            country: card.country,
            region: card.region,
            area: card.area,
            is_obsolete: card.is_obsolete || false,
            created_at: card.created_at                // 保留原始時間
        }));

        const { error: insertError } = await adminSupabaseClient
            .from('guest_postcards')
            .insert(newCards);

        if (insertError) throw insertError;

        return new Response(JSON.stringify({ 
            success: true, 
            message: `成功轉移 ${newCards.length} 張美片！` 
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // ============================================================
    // === 訪客專用功能 (無需 Auth) ===
    // ============================================================

    // 安全性核心：所有 Update/Delete 操作都必須強制加上 .eq('is_guest', true)
    
    if (action === 'get-guest-daily-count') {
        // 1. 獲取訪客 IP
        const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
        
        // ★ 新增：計算指紋 (與發送留言時的邏輯一致)
        let fingerprint = 'unknown';
        if (clientIp !== 'unknown') {
            const encoder = new TextEncoder();
            const data = encoder.encode(clientIp + 'SALT_2025');
            const hashBuffer = await crypto.subtle.digest('SHA-1', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            fingerprint = hashHex.substring(0, 6); 
        }
        
        // 2. 設定時間範圍 (過去 24 小時)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        // 3. 查詢大聲公數量 (Challenges)
        const { count: challengeCount, error: err1 } = await adminSupabaseClient
            .from('challenges')
            .select('*', { count: 'exact', head: true })
            .eq('is_guest', true)
            .eq('guest_ip', clientIp)
            .gte('created_at', oneDayAgo);

        // 4. 查詢自飛數量 (Guest Fly Posts)
        const { count: flyCount, error: err2 } = await adminSupabaseClient
            .from('guest_fly_posts')
            .select('*', { count: 'exact', head: true })
            .eq('guest_ip', clientIp)
            .gte('created_at', oneDayAgo);

        if (err1) throw new Error(err1.message);
        if (err2) throw new Error(err2.message);

        // ★ 合併計算總數
        const totalCount = (challengeCount || 0) + (flyCount || 0);

        // ★ 回傳合併後的 count
        return new Response(JSON.stringify({ 
            success: true, 
            data: { count: totalCount, limit: 6, ip_fingerprint: fingerprint } 
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // ★★★ 讀取訪客蘑菇列表 (讓未登入者也能讀取) ★★★
    if (action === 'list-guest-challenges') {
        const { data, error } = await adminSupabaseClient
            .from('challenges')
            .select('*, signups(*, profile:profiles(nickname))') 
            .eq('is_guest', true)
            .order('created_at', { ascending: false });

        if (error) throw new Error(error.message);

        return new Response(JSON.stringify({ success: true, data: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 讀取單筆訪客菇 (用於編輯回填，繞過 RLS) 
    if (action === 'get-guest-challenge') {
        const { challengeId } = payload;
        const { data, error } = await adminSupabaseClient
            .from('challenges')
            .select('*')
            .eq('id', challengeId)
            .single();

        if (error) throw new Error('無法讀取資料'); // 簡化錯誤訊息避免洩漏細節

        return new Response(JSON.stringify({ success: true, data: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 訪客發菇 (Create) - [IP 限制 + 圖片寫入]
    if (action === 'guest-create-challenge') {
        const { nickname, friendCode, mushroomType, slots, startTime, details, cookingStyle, notes, image_url } = payload;
        
        if (!nickname || !friendCode || !mushroomType || !startTime) throw new Error('欄位不完整');

        // ★ 1. 獲取訪客真實 IP
        const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';

        // ★ 2. 設定限制：過去 24 小時內
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        // ★ 3. 查詢該 IP 在「一般蘑菇」的發文量
        const { count: challengeCount, error: err1 } = await adminSupabaseClient
            .from('challenges')
            .select('*', { count: 'exact', head: true })
            .eq('is_guest', true)
            .eq('guest_ip', clientIp)
            .gte('created_at', oneDayAgo);

        // ★ 4. 查詢該 IP 在「自飛蘑菇」的發文量
        const { count: flyCount, error: err2 } = await adminSupabaseClient
            .from('guest_fly_posts')
            .select('*', { count: 'exact', head: true })
            .eq('guest_ip', clientIp)
            .gte('created_at', oneDayAgo);

        if (err1 || err2) throw new Error('系統忙碌中，請稍後再試');

        // ★ 5. 執行合併限制 (每日最多 6 則)
        const COMBINED_LIMIT = 6; 
        const currentTotal = (challengeCount || 0) + (flyCount || 0);

        if (currentTotal >= COMBINED_LIMIT) {
            throw new Error(`您今日(${clientIp})已達發布上限 (大聲公+自飛共 ${COMBINED_LIMIT} 則)，請明天再來！`);
        }

        const displayHostName = `${nickname}✈️${friendCode}`;
        
        const { data, error } = await adminSupabaseClient.from('challenges').insert({
            host_id: null, 
            display_host_name: displayHostName,
            mushroom_type: mushroomType,
            slots: parseInt(slots),
            start_time: startTime,
            details: details,
            cooking_style: cookingStyle,
            notes: notes,
            image_url: image_url, // ★ 寫入圖片網址
            status: new Date(startTime) > new Date() ? '預計開放' : '開放報名中',
            is_guest: true,
            guest_ip: clientIp // ★ 寫入 IP
        }).select().single();

        if (error) throw new Error(`訪客發布失敗: ${error.message}`);
        return new Response(JSON.stringify({ success: true, data: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 訪客編輯 (Update) - [狀態計算 + 舊圖清理]
    if (action === 'guest-edit-challenge') {
        const { challengeId, nickname, friendCode, mushroomType, slots, startTime, details, cookingStyle, notes, image_url } = payload;
        
        const displayHostName = `${nickname}✈️${friendCode}`;

        // ★ 1. 先查出舊資料 (為了拿舊圖 URL)
        const { data: oldData } = await adminSupabaseClient
            .from('challenges')
            .select('image_url')
            .eq('id', challengeId)
            .eq('is_guest', true)
            .single();
        
        // ★ 2. 查詢目前報名人數
        const { count: currentSignups, error: countErr } = await adminSupabaseClient
            .from('signups')
            .select('*', { count: 'exact', head: true })
            .eq('challenge_id', challengeId);
            
        if (countErr) throw new Error('無法確認報名狀態');

        const now = new Date();
        const start = new Date(startTime);
        const slotNum = parseInt(slots);
        const signupNum = currentSignups || 0;

        let status = '開放報名中';
        if (start > now) {
            status = '預計開放';
        } else if (signupNum >= slotNum) {
            status = '已額滿'; // 只要達到名額就標記額滿
        }

        // ★ 3. 準備更新物件
        const updatePayload: any = {
            display_host_name: displayHostName,
            mushroom_type: mushroomType,
            slots: slotNum,
            start_time: startTime,
            details: details,
            cooking_style: cookingStyle,
            notes: notes,
            status: status
        };
        // 只有當前端有傳 image_url (代表有換圖) 時才更新此欄位
        if (image_url) updatePayload.image_url = image_url;

        // ★ 4. 執行更新
        const { error, count } = await adminSupabaseClient
            .from('challenges')
            .update(updatePayload, { count: 'exact' }) 
            .eq('id', challengeId)
            .eq('is_guest', true); 

        if (error) throw new Error(`編輯失敗: ${error.message}`);
        if (count === 0) throw new Error('操作無效：找不到該訪客貼文，或無權限修改此項目。');

        // ★ 5. 垃圾清理：有換圖且有舊圖 -> 刪除舊圖 (濾除 URL 參數)
        if (image_url && oldData?.image_url && oldData.image_url !== image_url) {
            try {
                const oldFileName = oldData.image_url.split('/').pop()?.split('?')[0];
                if (oldFileName) await adminSupabaseClient.storage.from('challenge-images').remove([oldFileName]);
            } catch (e) { console.error('舊圖清理失敗', e); }
        }
        
        return new Response(JSON.stringify({ success: true, data: { message: '更新成功' } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 訪客刪除 (Delete) - [權限鎖定 + 圖片清理]
    if (action === 'guest-delete-challenge') {
        const { challengeId } = payload;
        
        // ★ 1. 先查出圖片 URL
        const { data: oldData } = await adminSupabaseClient
            .from('challenges')
            .select('image_url')
            .eq('id', challengeId)
            .eq('is_guest', true)
            .single();
        
        // ★ 2. 執行刪除 (強制鎖定只能刪訪客菇)
        const { error, count } = await adminSupabaseClient
            .from('challenges')
            .delete({ count: 'exact' }) 
            .eq('id', challengeId)
            .eq('is_guest', true); 

        if (error) throw new Error(`刪除失敗: ${error.message}`);
        
        if (count === 0) throw new Error('操作無效：找不到該訪客貼文，或無權限刪除此項目。');

        // ★ 3. 刪除 Storage 中的圖片檔案 (修正：濾除 URL 參數)
        if (oldData?.image_url) {
            try {
                const fileName = oldData.image_url.split('/').pop()?.split('?')[0];
                if (fileName) await adminSupabaseClient.storage.from('challenge-images').remove([fileName]);
            } catch (e) { console.error('圖片刪除失敗', e); }
        }
        
        return new Response(JSON.stringify({ success: true, data: { message: '刪除成功' } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // ★★★ 訪客報名 (Join) - 修改版：加入候補名額邏輯 (slots + 2) ★★★
    if (action === 'guest-join-challenge') {
        const { challengeId, nickname, friendCode } = payload;
        const guestName = `${nickname}💪${friendCode}`;

        // 1. 檢查挑戰是否存在 & 是否額滿 (使用原子查詢)
        const { data: challenge, error: findErr } = await adminSupabaseClient
            .from('challenges')
            .select('slots, status, signups(count)')
            .eq('id', challengeId)
            .single();

        if (findErr || !challenge) throw new Error('找不到該挑戰');
        
        // 安全取得目前人數
        const currentCount = challenge.signups?.[0]?.count ?? 0;
        
        // 允許報名直到 (名額 + 2)
        // 當人數達到 (Slots + 2) 時才擋下
        if (currentCount >= (challenge.slots + 2)) {
            // 如果已經滿了，順手修復狀態 (防呆)
            if (challenge.status !== '已額滿') {
                await adminSupabaseClient.from('challenges').update({ status: '已額滿' }).eq('id', challengeId);
            }
            throw new Error('報名失敗：連候補都滿囉！');
        }

        // 2. 檢查是否重複報名
        const { data: exist } = await adminSupabaseClient
            .from('signups')
            .select('id')
            .eq('challenge_id', challengeId)
            .eq('guest_name', guestName)
            .maybeSingle();

        if (exist) throw new Error('您已經報名過這場挑戰了');

        // ★★★ 新增：檢查備取上限 (Max 3) ★★★
        // 只有當本次報名屬於「備取」時 (目前人數 >= slots)，才需要檢查這個人手上是不是已經滿手備取了
        // 如果本次是「正取」，則不受備取上限限制
        if (currentCount >= challenge.slots) {
            // A. 查出這個人所有的報名紀錄
            const { data: myAllSignups } = await adminSupabaseClient
                .from('signups')
                .select('challenge_id, created_at')
                .eq('guest_name', guestName);
            
            if (myAllSignups && myAllSignups.length > 0) {
                let currentWaitlistCount = 0;
                
                // B. 逐一檢查這些報名是否為備取 (Rank > Slots)
                for (const s of myAllSignups) {
                    // 查該挑戰的名額
                    const { data: ch } = await adminSupabaseClient
                        .from('challenges')
                        .select('slots')
                        .eq('id', s.challenge_id)
                        .single();
                    
                    if (ch) {
                        // 查我在該挑戰的排名 (比我早報名的人數 + 1)
                        const { count: rank } = await adminSupabaseClient
                            .from('signups')
                            .select('*', { count: 'exact', head: true })
                            .eq('challenge_id', s.challenge_id)
                            .lte('created_at', s.created_at); // created_at <= 我的時間
                        
                        if ((rank || 0) > ch.slots) {
                            currentWaitlistCount++;
                        }
                    }
                }

                if (currentWaitlistCount >= 3) {
                    throw new Error('您同時排隊的備取已達上限 (3個)，請先取消其他備取。');
                }
            }
        }

        // 3. 寫入報名表
        const { data: newSignup, error: insertErr } = await adminSupabaseClient
            .from('signups')
            .insert({
                challenge_id: challengeId,
                guest_name: guestName,
                user_id: null
            })
            .select()
            .single();

        if (insertErr) throw new Error(`報名失敗: ${insertErr.message}`);

        // 報名成功後，檢查是否達到「正取名額」，若是則更新狀態為「已額滿」
        // (前端會根據人數判斷是否顯示備取按鈕，這裡只需負責切換狀態)
        const newTotal = currentCount + 1;
        if (newTotal >= challenge.slots) {
            await adminSupabaseClient
                .from('challenges')
                .update({ status: '已額滿' })
                .eq('id', challengeId);
        }

        return new Response(JSON.stringify({ success: true, data: newSignup }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 訪客取消報名 (Cancel) - 強化人數計算安全性
    if (action === 'guest-cancel-signup') {
        const { challengeId, nickname, friendCode } = payload;
        const guestName = `${nickname}💪${friendCode}`;

        // 1. 執行刪除
        const { error, count } = await adminSupabaseClient
            .from('signups')
            .delete({ count: 'exact' })
            .eq('challenge_id', challengeId)
            .eq('guest_name', guestName);

        if (error) throw new Error(`取消失敗: ${error.message}`);
        if (count === 0) throw new Error('取消失敗：找不到您的報名紀錄 (請確認暱稱與好友碼是否與報名時一致)');

        // 2. 重新計算狀態 (解決取消後狀態沒變回來的問題)
        const { data: challenge, error: getErr } = await adminSupabaseClient
            .from('challenges')
            .select('slots, start_time, status, signups(count)')
            .eq('id', challengeId)
            .single();

        if (!getErr && challenge) {
            // ★ 安全性修正：使用 Optional Chaining (?.) 避免當 count 為 0 時報錯
            const currentCount = challenge.signups?.[0]?.count ?? 0;
            
            const slots = challenge.slots;
            const now = new Date();
            const startTime = new Date(challenge.start_time);

            let newStatus = challenge.status;

            // 狀態判斷邏輯
            if (startTime > now) {
                newStatus = '預計開放';
            } 
            // ★ 修改：這裡也改回 >= slots，若取消後人數仍大於等於名額，維持已額滿
            else if (currentCount >= slots) {
                newStatus = '已額滿';
            } else {
                newStatus = '開放報名中';
            }

            // 若狀態有變，執行更新
            if (newStatus !== challenge.status) {
                await adminSupabaseClient
                    .from('challenges')
                    .update({ status: newStatus })
                    .eq('id', challengeId);
            }
        }

        return new Response(JSON.stringify({ success: true, data: { message: '已取消報名' } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 更新報名留言
    if (action === 'guest-update-signup-comment') {
        const { challengeId, nickname, friendCode, comment } = payload;
        const guestName = `${nickname}💪${friendCode}`;

        // 驗證身分並更新
        const { data, error } = await adminSupabaseClient
            .from('signups')
            .update({ comment: comment }) // 更新留言
            .eq('challenge_id', challengeId)
            .eq('guest_name', guestName)  // 確保是本人
            .select()
            .single();

        if (error) throw new Error('更新留言失敗，請確認身分');
        
        return new Response(JSON.stringify({ success: true, data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // ==========================================
    // ▼▼▼ 自飛蘑菇 (Self-Fly) 相關功能 (移至此處) ▼▼▼
    // ==========================================

    // 讀取自飛列表 (含清理與圖片刪除)
    if (action === 'list-guest-fly') {
        // 設定過期時間 (3小時前)
        const oneHourAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
        
        // ★ 1. 先查詢有哪些過期資料 (為了拿 image_url)
        const { data: expiredFly, error: fetchErr } = await adminSupabaseClient
            .from('guest_fly_posts')
            .select('id, image_url')
            .lt('created_at', oneHourAgo);

        if (!fetchErr && expiredFly && expiredFly.length > 0) {
            // ★ 2. 刪除圖片
            for (const item of expiredFly) {
                if (item.image_url) {
                    try {
                        const fileName = item.image_url.split('/').pop()?.split('?')[0];
                        if (fileName) {
                            await adminSupabaseClient.storage.from('challenge-images').remove([fileName]);
                        }
                    } catch (e) { console.error('自飛圖片清理失敗', e); }
                }
            }

            // ★ 3. 刪除資料庫紀錄
            await adminSupabaseClient
                .from('guest_fly_posts')
                .delete()
                .in('id', expiredFly.map(x => x.id));
        }

        // 4. 回傳最新的列表
        const { data, error } = await adminSupabaseClient
            .from('guest_fly_posts')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return new Response(JSON.stringify({ success: true, data: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 發布自飛 (Create) - [IP 限制 + 圖片寫入]
    if (action === 'guest-create-fly') {
      const { nickname, friendCode, mushroomType, slots, coordinates, cookingStyle, notes, image_url } = payload;
      
      // ★ 1. 獲取訪客真實 IP
      const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';

      // ★ 2. 設定限制：過去 24 小時內
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // ★ 3. 查詢該 IP 在「一般蘑菇」的發文量
      const { count: challengeCount, error: err1 } = await adminSupabaseClient
          .from('challenges')
          .select('*', { count: 'exact', head: true })
          .eq('is_guest', true)
          .eq('guest_ip', clientIp)
          .gte('created_at', oneDayAgo);

      // ★ 4. 查詢該 IP 在「自飛蘑菇」的發文量
      const { count: flyCount, error: err2 } = await adminSupabaseClient
          .from('guest_fly_posts')
          .select('*', { count: 'exact', head: true })
          .eq('guest_ip', clientIp)
          .gte('created_at', oneDayAgo);

      if (err1 || err2) throw new Error('系統忙碌中，請稍後再試');

      // ★ 5. 執行合併限制 (改為 6 則)
      const COMBINED_LIMIT = 6;
      const currentTotal = (challengeCount || 0) + (flyCount || 0);

      if (currentTotal >= COMBINED_LIMIT) {
          throw new Error(`您今日(${clientIp})已達發布上限 (大聲公+自飛共 ${COMBINED_LIMIT} 則)，請明天再來！`);
      }

      // 寫入資料
      const { data, error } = await adminSupabaseClient
        .from('guest_fly_posts')
        .insert({
          nickname,
          friend_code: friendCode,
          mushroom_type: mushroomType,
          slots: parseInt(slots),
          coordinates,
          cooking_style: cookingStyle,
          notes,
          image_url: image_url, // ★ 寫入圖片網址
          guest_ip: clientIp // ★ 寫入 IP
        })
        .select()
        .single();

      if (error) throw error;
      return new Response(JSON.stringify({ success: true, data: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 編輯自飛 - [舊圖清理]
    if (action === 'guest-edit-fly') {
      const { id, mushroomType, slots, coordinates, cookingStyle, notes, image_url } = payload;
      
      // ★ 1. 查舊圖
      const { data: oldData } = await adminSupabaseClient.from('guest_fly_posts').select('image_url').eq('id', id).single();

      // ★ 2. 準備更新物件
      const updatePayload: any = {
          mushroom_type: mushroomType,
          slots: parseInt(slots),
          coordinates,
          cooking_style: cookingStyle,
          notes
      };
      if (image_url) updatePayload.image_url = image_url;

      const { data, error } = await adminSupabaseClient
        .from('guest_fly_posts')
        .update(updatePayload)
        .eq('id', id)
        .select()
        .single();
        
      if (error) throw error;

      // ★ 3. 清理舊圖 (濾除 URL 參數)
      if (image_url && oldData?.image_url && oldData.image_url !== image_url) {
          try {
              const oldFileName = oldData.image_url.split('/').pop()?.split('?')[0];
              if (oldFileName) await adminSupabaseClient.storage.from('challenge-images').remove([oldFileName]);
          } catch (e) { console.error('舊圖清理失敗', e); }
      }

      return new Response(JSON.stringify({ success: true, data: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 刪除自飛 - [圖片清理]
    if (action === 'guest-delete-fly') {
      const { id } = payload;

      // ★ 1. 查圖
      const { data: oldData } = await adminSupabaseClient.from('guest_fly_posts').select('image_url').eq('id', id).single();

      // ★ 2. 刪紀錄
      const { error } = await adminSupabaseClient
        .from('guest_fly_posts')
        .delete()
        .eq('id', id);

      if (error) throw error;

      // ★ 3. 刪檔案 (濾除 URL 參數)
      if (oldData?.image_url) {
          try {
              const fileName = oldData.image_url.split('/').pop()?.split('?')[0];
              if (fileName) await adminSupabaseClient.storage.from('challenge-images').remove([fileName]);
          } catch (e) { console.error('圖片刪除失敗', e); }
      }

      return new Response(JSON.stringify({ success: true, message: 'Deleted' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 訪客發送留言 (含 IP 指紋計算)
    if (action === 'guest-send-message') {
        const { nickname, message } = payload;
        if (!message || !message.trim()) throw new Error('訊息不能為空');

        // 1. 獲取 IP
        const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
        
        // 2. 計算指紋 (簡單雜湊)
        let fingerprint = 'unknown';
        if (clientIp !== 'unknown') {
            const encoder = new TextEncoder();
            const data = encoder.encode(clientIp + 'SALT_2025');
            const hashBuffer = await crypto.subtle.digest('SHA-1', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            fingerprint = hashHex.substring(0, 6); 
        }

        // 3. 寫入資料庫 (使用 adminSupabaseClient 繞過 RLS)
        const { data, error } = await adminSupabaseClient
            .from('guest_messages')
            .insert({
                nickname: nickname,
                message: message,
                ip_fingerprint: fingerprint
            })
            .select()
            .single();

        if (error) throw error;

        return new Response(JSON.stringify({ success: true, data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 訪客編輯留言 (驗證 IP 指紋)
    if (action === 'guest-edit-message') {
        const { id, message } = payload;
        if (!message || !message.trim()) throw new Error('訊息不能為空');

        // 1. 獲取 IP 並計算指紋 (權限驗證核心)
        const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
        let fingerprint = 'unknown';
        if (clientIp !== 'unknown') {
            const encoder = new TextEncoder();
            const data = encoder.encode(clientIp + 'SALT_2025');
            const hashBuffer = await crypto.subtle.digest('SHA-1', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            fingerprint = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 6);
        }

        // 2. 執行更新 (加入指紋比對條件，確保只能改自己的)
        const { error, count } = await adminSupabaseClient
            .from('guest_messages')
            .update({ message: message })
            .eq('id', id)
            .eq('ip_fingerprint', fingerprint); // ★ 關鍵安全鎖

        if (error) throw error;
        if (count === 0) throw new Error('權限不足或留言不存在');

        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 訪客刪除留言 (收回) (驗證 IP 指紋)
    if (action === 'guest-delete-message') {
        const { id } = payload;

        // 1. 計算指紋
        const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
        let fingerprint = 'unknown';
        if (clientIp !== 'unknown') {
            const encoder = new TextEncoder();
            const data = encoder.encode(clientIp + 'SALT_2025');
            const hashBuffer = await crypto.subtle.digest('SHA-1', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            fingerprint = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 6);
        }

        // 2. 執行刪除 (加入指紋比對)
        const { error, count } = await adminSupabaseClient
            .from('guest_messages')
            .delete({ count: 'exact' })
            .eq('id', id)
            .eq('ip_fingerprint', fingerprint); // ★ 關鍵安全鎖

        if (error) throw error;
        if (count === 0) throw new Error('權限不足或留言不存在');

        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // ==========================================
    // ▼▼▼ 純點雷達站 (Radar) - 公開功能區 ▼▼▼
    // (放在區塊 B 檢查之前，讓訪客也能讀取)
    // ==========================================

    // 1. 取得所有分類
    if (action === 'get-radar-categories') {
        const { data, error } = await adminSupabaseClient
            .from('radar_categories')
            .select('id, name, image_url, sort_order')
            .order('sort_order', { ascending: true });

        if (error) throw error;
        
        // 簡單計算每個分類的貼文數
        const { data: counts } = await adminSupabaseClient.from('radar_posts').select('category_id');
        const countMap: Record<string, number> = {};
        if (counts) counts.forEach((c: any) => countMap[c.category_id] = (countMap[c.category_id] || 0) + 1);

        const result = data.map((c: any) => ({ ...c, count: countMap[c.id] || 0 }));
        return new Response(JSON.stringify({ success: true, data: result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 2. 取得雷達點 (需手動檢查 Auth 以判斷投票狀態)
    if (action === 'get-radar-posts') {
        const { categoryId } = payload;
        const authHeader = req.headers.get('Authorization'); // 手動獲取
        
        const { data, error } = await adminSupabaseClient
            .from('radar_posts')
            .select('*')
            .eq('category_id', categoryId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // 判斷使用者投票狀態
        let userVotes: any[] = [];
        const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
        
        // A. 嘗試用 Token 查
        if (authHeader) {
             const tempClient = createClient(
                  Deno.env.get('SUPABASE_URL') ?? '',
                  Deno.env.get('PUBLIC_KEY') ?? '',
                  { global: { headers: { Authorization: authHeader } } }
             );
             const { data: uData } = await tempClient.auth.getUser();
             if (uData?.user) {
                 const { data: votes } = await adminSupabaseClient.from('radar_votes').select('post_id, vote_type').eq('user_id', uData.user.id);
                 userVotes = votes || [];
             }
        } 
        
        // B. 如果沒登入，用 IP 查
        if (userVotes.length === 0 && clientIp !== 'unknown') {
            const encoder = new TextEncoder();
            const d = encoder.encode(clientIp + 'SALT_2025');
            const hashBuffer = await crypto.subtle.digest('SHA-1', d);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const fingerprint = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 6);
            const { data: votes } = await adminSupabaseClient.from('radar_votes').select('post_id, vote_type').eq('ip_fingerprint', fingerprint);
            userVotes = votes || [];
        }

        const voteMap: Record<string, string> = {}; 
        userVotes.forEach((v: any) => voteMap[v.post_id] = v.vote_type);

        const result = data.map((p: any) => ({ ...p, my_vote: voteMap[p.id] || null }));
        return new Response(JSON.stringify({ success: true, data: result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 3. 發布雷達點 (含座標重複檢查 + 第三層 area)
    if (action === 'create-radar-post') {
        const { categoryId, coordinates, country, region, area, nickname } = payload;
        const authHeader = req.headers.get('Authorization');
        
        // 檢查座標是否重複 (改為回傳 200 + success: false)
        const { data: existing } = await adminSupabaseClient
            .from('radar_posts')
            .select('id')
            .eq('coordinates', coordinates)
            .maybeSingle();

        if (existing) {
            // 這裡改成回傳 200 OK，但在 JSON 裡告訴前端 success: false
            return new Response(JSON.stringify({ 
                success: false, 
                message: '此座標已經被登錄過了！謝謝您的分享。' 
            }), { 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200 // 狀態碼改為 200，瀏覽器就不會報紅字
            });
        }

        // 2. 判斷 Uploader
        let uploaderId = null;
        if (authHeader) {
             const tempClient = createClient(
                  Deno.env.get('SUPABASE_URL') ?? '',
                  Deno.env.get('PUBLIC_KEY') ?? '',
                  { global: { headers: { Authorization: authHeader } } }
             );
             const { data: uData } = await tempClient.auth.getUser();
             if (uData?.user) uploaderId = uData.user.id;
        }

        // 3. 寫入資料 (含 area)
        const { data, error } = await adminSupabaseClient
            .from('radar_posts')
            .insert({
                category_id: categoryId,
                coordinates,
                country,
                region,
                area: area || '', // 第三層
                uploader_nickname: nickname,
                uploader_id: uploaderId
            })
            .select().single();

        if (error) throw error;
        return new Response(JSON.stringify({ success: true, data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 編輯雷達點 (權限檢查：本人或管理員)
    if (action === 'update-radar-post') {
        const { postId, coordinates, country, region, area } = payload;
        const authHeader = req.headers.get('Authorization');

        // 1. 先查該貼文的原始資料 (確認擁有者)
        const { data: post } = await adminSupabaseClient.from('radar_posts').select('uploader_id').eq('id', postId).single();
        if (!post) throw new Error('找不到該貼文');

        // 2. 辨識當前請求者身分
        let currentUserId = null;
        let isAdmin = false;

        if (authHeader) {
             const tempClient = createClient(
                  Deno.env.get('SUPABASE_URL') ?? '',
                  Deno.env.get('PUBLIC_KEY') ?? '',
                  { global: { headers: { Authorization: authHeader } } }
             );
             const { data: uData } = await tempClient.auth.getUser();
             if (uData?.user) {
                 currentUserId = uData.user.id;
                 // 順便查是否為管理員
                 const { data: profile } = await adminSupabaseClient.from('profiles').select('role').eq('id', currentUserId).single();
                 if (profile?.role === '管理者') isAdmin = true;
             }
        }

        // 3. 權限比對
        // 允許編輯條件：是管理員 OR (是登入用戶 且 ID與貼文上傳者一致)
        const isOwner = post.uploader_id && post.uploader_id === currentUserId;
        
        if (!isAdmin && !isOwner) {
            throw new Error('您無權編輯此貼文 (僅限發布者或管理員)');
        }

        // 4. 執行更新
        const { error } = await adminSupabaseClient
            .from('radar_posts')
            .update({
                coordinates,
                country,
                region,
                area: area || ''
            })
            .eq('id', postId);

        if (error) throw error;
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 4. 投票 (允許訪客)
    if (action === 'vote-radar-post') {
        const { postId, type } = payload;
        const authHeader = req.headers.get('Authorization'); // 手動獲取
        
        let userId = null;
        let fingerprint = null;

        if (authHeader) {
             const tempClient = createClient(
                  Deno.env.get('SUPABASE_URL') ?? '',
                  Deno.env.get('PUBLIC_KEY') ?? '',
                  { global: { headers: { Authorization: authHeader } } }
             );
             const { data: uData } = await tempClient.auth.getUser();
             if (uData?.user) userId = uData.user.id;
        }

        if (!userId) {
            const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
            const encoder = new TextEncoder();
            const d = encoder.encode(clientIp + 'SALT_2025');
            const hashBuffer = await crypto.subtle.digest('SHA-1', d);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            fingerprint = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 6);
        }

        let query = adminSupabaseClient.from('radar_votes').select('*').eq('post_id', postId);
        if (userId) query = query.eq('user_id', userId);
        else query = query.eq('ip_fingerprint', fingerprint);

        const { data: existing } = await query.maybeSingle();

        if (existing) {
            if (existing.vote_type === type) await adminSupabaseClient.from('radar_votes').delete().eq('id', existing.id);
            else await adminSupabaseClient.from('radar_votes').update({ vote_type: type }).eq('id', existing.id);
        } else {
            await adminSupabaseClient.from('radar_votes').insert({
                post_id: postId, user_id: userId, ip_fingerprint: fingerprint, vote_type: type
            });
        }

        await adminSupabaseClient.rpc('update_radar_vote_counts', { p_id: postId });
        const { data: newCounts } = await adminSupabaseClient.from('radar_posts').select('pure_count, impure_count').eq('id', postId).single();
        
        return new Response(JSON.stringify({ success: true, data: newCounts }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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


    // ▼▼▼ 純點雷達站 - 需驗證功能

    // 5. 管理員編輯分類 (含舊圖清理)
    if (action === 'update-radar-category') {
        const { id, name, image_url } = payload;
        const { data: profile } = await adminSupabaseClient.from('profiles').select('role').eq('id', user.id).single();
        if (profile?.role !== '管理者') throw new Error('權限不足');

        // ★ 1. 先查出舊資料 (為了拿舊圖 URL)
        const { data: oldCat } = await adminSupabaseClient
            .from('radar_categories')
            .select('image_url')
            .eq('id', id)
            .single();

        const updateData: any = {};
        if (name) updateData.name = name;
        if (image_url) updateData.image_url = image_url;

        // ★ 2. 執行更新
        const { error } = await adminSupabaseClient.from('radar_categories').update(updateData).eq('id', id);
        if (error) throw error;

        // ★ 3. 垃圾清理：有換圖(image_url存在) 且 有舊圖 且 新舊不同 -> 刪除舊圖
        // 注意：這裡是刪除 radar-category-images 裡的圖
        if (image_url && oldCat?.image_url && oldCat.image_url !== image_url) {
            try {
                // 濾除 URL 參數 (?t=...) 取出檔名
                const oldFileName = oldCat.image_url.split('/').pop()?.split('?')[0];
                if (oldFileName) {
                    await adminSupabaseClient.storage.from('radar-category-images').remove([oldFileName]);
                    console.log(`[Radar] 舊分類圖已刪除: ${oldFileName}`);
                }
            } catch (e) {
                console.error('舊圖清理失敗 (不影響更新):', e);
            }
        }

        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 6. 刪除雷達點 (本人或管理員)
    if (action === 'delete-radar-post') {
        const { postId } = payload;
        const { data: post } = await adminSupabaseClient.from('radar_posts').select('uploader_id').eq('id', postId).single();
        if (!post) throw new Error('找不到貼文');

        let isAllowed = false;
        const { data: profile } = await adminSupabaseClient.from('profiles').select('role').eq('id', user.id).single();
        if (profile?.role === '管理者') isAllowed = true;
        if (post.uploader_id && post.uploader_id === user.id) isAllowed = true;

        if (!isAllowed) throw new Error('無權刪除');

        const { error } = await adminSupabaseClient.from('radar_posts').delete().eq('id', postId);
        if (error) throw error;
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }


    // ============================================================
    // 區塊 B1：一般使用者功能 (B1 - General User Actions)
    // 只要是登入的使用者皆可執行，無需管理員權限
    // ============================================================

    // 用戶更新自己的報名留言
    if (action === 'user-update-signup-comment') {
        const { challengeId, comment } = payload;
        
        // 驗證並更新 (確保只能改自己的 user_id)
        const { data, error } = await adminSupabaseClient
            .from('signups')
            .update({ comment: comment })
            .eq('challenge_id', challengeId)
            .eq('user_id', user.id) // ★ 關鍵：鎖定 user.id
            .select()
            .single();

        if (error) throw new Error('更新失敗，找不到報名紀錄');
        
        return new Response(JSON.stringify({ success: true, data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 1. 更新訂閱狀態 (改為布林值切換)
    if (action === 'update-subscription') {
        if (payload.userId !== user.id) throw new Error('權限不足 (ID 不符)');
        
        // 判斷是哪種訂閱
        const column = payload.type === 'full' ? 'is_subscribed_full' : 'is_subscribed_signup';
        const newStatus = payload.status; // 前端會傳來 true (訂閱) 或 false (取消)

        const updateData: any = {};
        updateData[column] = newStatus;

        const { error } = await adminSupabaseClient.from('profiles').update(updateData).eq('id', user.id);
        
        if (error) throw error;
        
        return new Response(JSON.stringify({ 
            success: true, 
            data: { message: '狀態已更新' } 
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

    // --- 美片圖書館 Actions ---
    // 4. 發布新美片
    if (action === 'add-postcard') {
        const { uploaderId, uploaderNickname, coordinate, imageUrl, tags, country, region, area } = payload;
        
        if (user.id !== uploaderId) throw new Error('身分驗證失敗');

        // 1. 檢查座標重複
        const { data: existing } = await adminSupabaseClient
            .from('postcards')
            .select('id')
            .eq('coordinate', coordinate)
            .maybeSingle();

        if (existing) {
            return new Response(JSON.stringify({ success: false, message: '此座標已經被登錄過了！' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
        }

        // 2. 寫入 postcards 表
        const { data: newCard, error: insertErr } = await adminSupabaseClient
            .from('postcards')
            .insert({
                uploader_id: uploaderId,
                uploader_nickname: uploaderNickname,
                coordinate: coordinate,
                image_url: imageUrl,
                tags: tags,
                country: country || '', 
                region: region || '',   
                area: area || '',       
                likes: 0
            })
            .select()
            .single();

        if (insertErr) throw insertErr;

        // 3. 手動更新 profiles 的「本週」與「本月」欄位 (+1)
        try {
            const { data: p, error: getErr } = await adminSupabaseClient
                .from('profiles')
                .select('weekly_postcard_count, monthly_postcard_count')
                .eq('id', uploaderId)
                .single();
            
            if (p) {
                const { error: upErr } = await adminSupabaseClient.from('profiles').update({
                    weekly_postcard_count: (p.weekly_postcard_count || 0) + 1,
                    monthly_postcard_count: (p.monthly_postcard_count || 0) + 1
                }).eq('id', uploaderId);

                if (upErr) console.error('[Add Postcard] 更新計數失敗:', upErr);
            }
        } catch (e) {
            console.error('[Add Postcard] 計數邏輯異常:', e);
        }
        
        return new Response(JSON.stringify({ success: true, data: newCard }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 5. 刪除美片 (含計數扣除)
    if (action === 'delete-postcard') {
        const { postcardId } = payload;
        
        // 1. 查驗權限
        const { data: card } = await adminSupabaseClient.from('postcards').select('uploader_id, image_url').eq('id', postcardId).single();
        if (!card) throw new Error('找不到該美片');
        
        const { data: operatorProfile } = await adminSupabaseClient.from('profiles').select('role').eq('id', user.id).single();
        const isAdmin = operatorProfile?.role === '管理者';
        
        if (card.uploader_id !== user.id && !isAdmin) throw new Error('權限不足');

        // 2. 刪除圖片 (Storage)
        if (card.image_url) {
            try {
                // 修正：先濾掉 ?token 參數再抓檔名
                const fileName = card.image_url.split('/').pop()?.split('?')[0];
                if (fileName) await adminSupabaseClient.storage.from('postcard-images').remove([fileName]);
            } catch (e) { console.error('圖片刪除失敗', e); }
        }

        // 3. 刪除資料庫紀錄
        const { error: delErr } = await adminSupabaseClient.from('postcards').delete().eq('id', postcardId);
        if (delErr) throw delErr;

        // 4. 更新 profiles 的「本週」與「本月」欄位 (-1)
        if (card.uploader_id) {
            try {
                const { data: p, error: getErr } = await adminSupabaseClient
                    .from('profiles')
                    .select('weekly_postcard_count, monthly_postcard_count')
                    .eq('id', card.uploader_id)
                    .single();
                
                if (p) {
                    // 防呆：確保不會扣成負數
                    const newWeek = (p.weekly_postcard_count || 0) > 0 ? (p.weekly_postcard_count - 1) : 0;
                    const newMonth = (p.monthly_postcard_count || 0) > 0 ? (p.monthly_postcard_count - 1) : 0;

                    const { error: upErr } = await adminSupabaseClient.from('profiles').update({
                        weekly_postcard_count: newWeek,
                        monthly_postcard_count: newMonth
                    }).eq('id', card.uploader_id);

                    if (upErr) console.error('[Delete Postcard] 扣除計數失敗:', upErr);
                }
            } catch (e) {
                console.error('[Delete Postcard] 計數扣除異常:', e);
            }
        }

        return new Response(JSON.stringify({ success: true, data: { message: '刪除成功' } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    // 6. 編輯美片 (支援換圖 + 座標重複檢查) [ 加入地區欄位]
    if (action === 'edit-postcard') {
        const { postcardId, coordinate, tags, imageUrl, country, region, area } = payload;
        
        // 1. 查出舊資料
        const { data: oldCard } = await adminSupabaseClient.from('postcards').select('uploader_id, image_url').eq('id', postcardId).single();
        if (!oldCard) throw new Error('找不到該美片');

        const { data: operatorProfile } = await adminSupabaseClient.from('profiles').select('role').eq('id', user.id).single();
        const isAdmin = operatorProfile?.role === '管理者';

        if (oldCard.uploader_id !== user.id && !isAdmin) throw new Error('權限不足');

        // 檢查座標是否與「其他」卡片重複
        const { data: existing } = await adminSupabaseClient
            .from('postcards')
            .select('id')
            .eq('coordinate', coordinate)
            .neq('id', postcardId)
            .maybeSingle();

        if (existing) {
            return new Response(JSON.stringify({ 
                success: false, 
                message: '修改失敗：此座標已存在於其他卡片中。' 
            }), { 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200 
            });
        }

        // 2. 準備更新資料 (加入 country, region, area)
        const updateData: any = { 
            coordinate, 
            tags,
            country: country || '', 
            region: region || '',  
            area: area || ''      
        };
        if (imageUrl) {
            updateData.image_url = imageUrl;
        }

        // 3. 執行更新
        const { error } = await adminSupabaseClient
            .from('postcards')
            .update(updateData)
            .eq('id', postcardId);

        if (error) throw error;

        // 4. 刪除舊圖
        if (imageUrl && oldCard.image_url) {
            try {
                const oldFileName = oldCard.image_url.split('/').pop()?.split('?')[0];
                const newFileName = imageUrl.split('/').pop()?.split('?')[0];
                if (oldFileName && oldFileName !== newFileName) {
                    await adminSupabaseClient.storage.from('postcard-images').remove([oldFileName]);
                }
            } catch (e) { console.error('舊圖刪除失敗:', e); }
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

    // 8. 回報/取消絕版 (Toggle Obsolete)
    if (action === 'toggle-postcard-obsolete') {
        const { postcardId } = payload;
        
        // 1. 查詢目前狀態
        const { data: card, error: fetchErr } = await adminSupabaseClient
            .from('postcards')
            .select('is_obsolete')
            .eq('id', postcardId)
            .single();
            
        if (fetchErr || !card) throw new Error('找不到該美片');

        // 2. 切換狀態 (True <-> False)
        const newStatus = !card.is_obsolete;

        const { error: updateErr } = await adminSupabaseClient
            .from('postcards')
            .update({ is_obsolete: newStatus })
            .eq('id', postcardId);

        if (updateErr) throw updateErr;

        return new Response(JSON.stringify({ 
            success: true, 
            data: { 
                is_obsolete: newStatus,
                message: newStatus ? '已標記為絕版' : '已恢復為上架狀態'
            } 
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
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
        
        // Case 1: 管理員刪除單一留言
        case 'admin-delete-message': {
            const { id } = payload;
            if (!id) throw new Error('Missing message ID');

            // ★修正：改用 adminSupabaseClient
            const { error } = await adminSupabaseClient 
                .from('guest_messages')
                .delete()
                .eq('id', id);

            if (error) throw error;
            
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }

        // Case 2: 管理員清空所有留言
        case 'admin-clear-chat': {
            // ★修正：改用 adminSupabaseClient
            const { error } = await adminSupabaseClient
                .from('guest_messages')
                .delete()
                .gt('id', 0); 

            if (error) throw error;

            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }

        // Case 3: 管理員批量刪除留言 (新增)
        case 'admin-batch-delete-messages': {
            const { ids } = payload;
            if (!ids || !Array.isArray(ids) || ids.length === 0) {
                throw new Error('未選擇任何留言');
            }

            // 使用 .in() 語法進行批量刪除
            const { error } = await adminSupabaseClient
                .from('guest_messages')
                .delete()
                .in('id', ids);

            if (error) throw error;

            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }

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

       case 'get-subscriber-counts': 
            // 統計報名通知人數
            const { count: signupCount, error: cErr1 } = await adminSupabaseClient
                .from('profiles')
                .select('*', { count: 'exact', head: true })
                .eq('is_subscribed_signup', true);
            
            // 統計額滿通知人數
            const { count: fullCount, error: cErr2 } = await adminSupabaseClient
                .from('profiles')
                .select('*', { count: 'exact', head: true })
                .eq('is_subscribed_full', true);

            if (cErr1 || cErr2) throw new Error('統計失敗');
            
            data = { 
                signupCount: signupCount || 0,
                fullCount: fullCount || 0
            };
            break;

        case 'delete-challenge':
            if (!payload.challengeId) throw new Error('缺少 challengeId');
            const { data: challengeData } = await adminSupabaseClient
                .from('challenges')
                .select('image_url')
                .eq('id', payload.challengeId)
                .single();

            // 濾除 URL 參數
            if (challengeData && challengeData.image_url) {
                try {
                    const fileName = challengeData.image_url.split('/').pop()?.split('?')[0];
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

        // 掃描重複座標 (跨資料庫比對)
        case 'scan-duplicate-coordinates': {
            // 1. 撈取 美片圖書館 (Library) 全部資料
            const { data: libCards } = await adminSupabaseClient
                .from('postcards')
                .select('id, coordinate, image_url, uploader_nickname, created_at')
                .order('created_at', { ascending: false });

            // 2. 撈取 美片藝廊 (Gallery) 全部資料
            const { data: guestCards } = await adminSupabaseClient
                .from('guest_postcards')
                // ★ 修改：多撈取 ip_fingerprint 欄位，用於判斷是否為轉移檔
                .select('id, coordinate, image_url, nickname, friend_code, created_at, ip_fingerprint')
                .order('created_at', { ascending: false });

            // 3. 進行座標分組
            const map = new Map<string, any[]>();

            // 輔助函式：標準化座標字串 (去除空白，統一格式)
            const normalize = (coord: string) => {
                if (!coord) return '';
                return coord.replace(/\s/g, ''); 
            };

            // 整理 Library 資料
            libCards?.forEach((c: any) => {
                const key = normalize(c.coordinate);
                if (!key) return;
                if (!map.has(key)) map.set(key, []);
                map.get(key).push({
                    id: c.id,
                    source: 'library',
                    sourceLabel: '圖書館',
                    coordinate: c.coordinate,
                    image_url: c.image_url,
                    name: c.uploader_nickname || '匿名',
                    created_at: c.created_at
                });
            });

            // 整理 Gallery 資料
            guestCards?.forEach((c: any) => {
                // ★ 新增過濾：如果是從圖書館轉移過去的 (system_import)，視為合法分身，跳過不檢查
                if (c.ip_fingerprint === 'system_import') return;

                const key = normalize(c.coordinate);
                if (!key) return;
                if (!map.has(key)) map.set(key, []);
                map.get(key).push({
                    id: c.id,
                    source: 'gallery',
                    sourceLabel: '藝廊',
                    coordinate: c.coordinate,
                    image_url: c.image_url,
                    name: c.nickname || '匿名',
                    friend_code: c.friend_code,
                    created_at: c.created_at
                });
            });

            // 4. 篩選出「有重複」的群組 (數量 > 1)
            const duplicates = [];
            for (const [key, items] of map.entries()) {
                if (items.length > 1) {
                    items.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                    duplicates.push({ coordinateKey: key, items });
                }
            }

            data = { duplicates, totalGroups: duplicates.length };
            break;
        }

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
            
        // 同時更新暱稱與備註
        case 'update-user-nickname': 
            // 1. 如果暱稱有變更，才執行 Auth 更新 (避免不必要的 API 呼叫)
            if (payload.newNickname !== payload.oldNickname) {
                // 計算新 Hex 虛擬信箱
                const newHexNickname = Array.from(new TextEncoder().encode(payload.newNickname))
                    .map(b => b.toString(16).padStart(2, '0')).join('');
                const newVirtualEmail = `${newHexNickname}@pikmin.sys`;

                // 更新 Supabase Auth
                const { error: authUpdateErr } = await adminSupabaseClient.auth.admin.updateUserById(
                    payload.userId, 
                    { email: newVirtualEmail }
                );
                
                if (authUpdateErr) throw new Error(`Auth 更新失敗: ${authUpdateErr.message}`);
                
                // 更新 Partners 表 (如果有對應的話)
                await adminSupabaseClient
                    .from('partners')
                    .update({ name: payload.newNickname })
                    .eq('name', payload.oldNickname);
            }

            // 2. 更新 Profiles 表 (暱稱 + 備註)
            const updateProfileData: any = {
                nickname: payload.newNickname
            };
            // 如果前端有傳 notes 欄位，則更新備註
            if (payload.notes !== undefined) {
                updateProfileData.notes = payload.notes;
            }

            const { error: pErr } = await adminSupabaseClient
                .from('profiles')
                .update(updateProfileData)
                .eq('id', payload.userId);
            
            if (pErr) throw pErr;
            
            break;
            
        case 'get-daily-limit': 
            ({ data } = await adminSupabaseClient.from('daily_settings').select('setting_value').eq('setting_name', 'daily_signup_limit').single()); 
            break;
            
        case 'set-daily-limit': 
            ({ data } = await adminSupabaseClient.from('daily_settings').update({ setting_value: payload.value, updated_at: new Date().toISOString() }).eq('setting_name', 'daily_signup_limit').select().single()); 
            break;
            
        case 'daily-reset-absent':
            // ★ 修改：移除無效的空 update，只保留 RPC 呼叫
            const { error: rpcErr } = await adminSupabaseClient.rpc('daily_reduce_absent_score');
            
            if (rpcErr) throw rpcErr;
            
            data = { message: '每日缺席分數已執行 -1' };
            break;

        case 'ping': 
            break;
            
        case 'get-system-stats': {
            // 1. 查詢 DB 總容量
            const { data: dbBytes } = await adminSupabaseClient.rpc('get_database_size_bytes');

            // 2. 查詢 DB 資料表細項
            const { data: tableStats, error: tableError } = await adminSupabaseClient.rpc('get_table_stats');
            if (tableError) console.error('DB Stats Error:', tableError);

            // 3. 查詢 Storage 儲存庫細項 (取代原本只查單一 Bucket 的做法)
            const { data: bucketStats, error: storageError } = await adminSupabaseClient.rpc('get_storage_stats');
            if (storageError) console.error('Storage Stats Error:', storageError);

            // 計算 Storage 總容量
            const totalStorageBytes = bucketStats?.reduce((acc: number, b: any) => acc + (b.total_bytes || 0), 0) || 0;

            data = {
                dbSizeMB: parseFloat((dbBytes / 1024 / 1024).toFixed(2)),
                tableDetails: tableStats || [],
                storageMB: parseFloat((totalStorageBytes / 1024 / 1024).toFixed(2)),
                bucketDetails: bucketStats || [] // 回傳 Bucket 細項
            };
            break;
        }
     
        default: throw new Error(`未知的操作: ${action}`);

    }

    return new Response(JSON.stringify({ success: true, data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});