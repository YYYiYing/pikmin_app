// service-worker.js

// 監聽 'push' 事件。
// 當 Supabase 或您的後端發送推播訊息給瀏覽器時，瀏覽器會喚醒這個 Service Worker，
// 並將收到的資料作為一個 'push' 事件來觸發這段程式碼。
self.addEventListener('push', event => {
  
  // 從收到的推播訊息中，解析出要顯示的資料。
  // 我們預期後端會傳來一個 JSON 格式的字串，其中包含 title 和 body。
  const data = event.data.json();

  // 準備要顯示在作業系統通知上的選項。
  const options = {
    body: data.body, // 通知的內文 (例如："您的「巨菇」已額滿，準備出發吧！")
    icon: './mashroom_s.png', // 使用您現有的圖示作為通知的小圖示
    badge: './mashroom_s.png' // 在某些行動裝置上(如 Android)會顯示的一個單色小徽章
  };

  // event.waitUntil() 會告訴瀏覽器，在我們的通知顯示操作完成之前，不要終止這個 Service Worker。
  event.waitUntil(
    // 呼叫 Service Worker 的 showNotification API 來真正地觸發作業系統的原生通知。
    // 第一個參數是通知的標題，第二個參數是包含內文、圖示等選項的物件。
    self.registration.showNotification(data.title, options)
  );
});