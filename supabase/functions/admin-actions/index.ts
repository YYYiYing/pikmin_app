//
// 檔案路徑: supabase/functions/admin-actions/index.ts
//
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS Headers - 允許來自任何來源的請求
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 建立一個具備使用者權限的 Supabase client
    const userSupabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // 從 token 中獲取使用者資料，並驗證其角色
    const { data: { user } } = await userSupabaseClient.auth.getUser();
    if (!user) throw new Error('無效的使用者或 Token');

    const { data: profile, error: profileError } = await userSupabaseClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError || profile.role !== '管理者') {
      throw new Error('權限不足');
    }

    // 驗證通過後，建立一個具備最高權限的 Admin client
    const adminSupabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    );
    
    // 解析前端傳來的請求
    const { action, payload } = await req.json();
    let data = null;
    let error = null;

    switch (action) {
      case 'create-user':
        ({ data, error } = await adminSupabaseClient.auth.admin.createUser({
          email: payload.email,
          password: payload.password,
          email_confirm: true,
        }));
        if (!error && data.user) {
            const { error: profileError } = await adminSupabaseClient.from('profiles').insert({
                id: data.user.id,
                nickname: payload.nickname,
                role: payload.role
            });
            if (profileError) {
              // 如果建立 profile 失敗，復原已建立的 auth.user
              await adminSupabaseClient.auth.admin.deleteUser(data.user.id);
              throw profileError;
            }
        }
        break;
      
      case 'update-user-role':
        ({ data, error } = await adminSupabaseClient.from('profiles')
            .update({ role: payload.role })
            .eq('id', payload.userId)
            .select());
        break;

      case 'reset-user-password':
        ({ data, error } = await adminSupabaseClient.auth.admin.updateUserById(
          payload.userId,
          { password: payload.password }
        ));
        break;

      case 'delete-challenge':
        ({ error } = await adminSupabaseClient.from('challenges')
            .delete()
            .eq('id', payload.challengeId));
        break;
        
      default:
        throw new Error('未知的操作');
    }

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});