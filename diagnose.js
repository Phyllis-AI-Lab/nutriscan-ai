import fs from 'fs';
import path from 'path';

// 1. 強制讀取 .env 檔案中的鑰匙
try {
    const envPath = path.resolve(process.cwd(), '.env');
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const match = envContent.match(/VITE_GEMINI_API_KEY=(.+)/);
    
    if (!match || !match[1]) {
        console.error("❌ 錯誤：在 .env 檔案中找不到 VITE_GEMINI_API_KEY");
        process.exit(1);
    }

    const apiKey = match[1].trim();
    console.log(`🔑 偵測到 API Key: ${apiKey.slice(0, 5)}...******`);
    console.log("📡 正在連線 Google 伺服器查詢可用模型...");

    // 2. 直接問 Google
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await response.json();

    if (data.error) {
        console.error("\n❌ Google API 回傳錯誤：");
        console.error(`   代碼: ${data.error.code}`);
        console.error(`   訊息: ${data.error.message}`);
        console.log("   (請檢查你的 Key 是否有權限或已過期)");
    } else {
        console.log("\n✅ Google 伺服器確認您的鑰匙可用以下模型：");
        console.log("------------------------------------------------");
        
        // 3. 過濾出能「產出內容 (generateContent)」的模型
        const availableModels = data.models
            .filter(m => m.supportedGenerationMethods.includes("generateContent"))
            .map(m => m.name.replace('models/', '')); // 去掉前綴方便閱讀

        // 特別標記我們想用的
        availableModels.forEach(model => {
            if (model.includes('flash')) {
                console.log(`🚀 ${model} (推薦使用)`);
            } else {
                console.log(`   ${model}`);
            }
        });
        
        console.log("------------------------------------------------");
        console.log("👉 請將上面有列出的模型名稱 (例如 gemini-1.5-flash)，填入 App.jsx");
    }

} catch (err) {
    console.error("❌ 執行失敗:", err.message);
}