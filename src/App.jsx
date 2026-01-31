import { useState, useRef, useEffect } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Camera, Leaf, Info, RotateCcw, Edit3, Check, Image as ImageIcon, Sparkles, Activity, ShieldAlert, Trash2, CalendarDays, ChevronDown, ChevronUp, RefreshCw, ArrowLeft, Save, Archive, ArrowUpFromLine, Plus, X } from 'lucide-react';

function App() {
  // ✅ 核心鎖定：依照指示使用 gemini-flash-latest
  const MODEL_NAME = "gemini-flash-latest";
  const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

  // --- 狀態管理 (保留歷史紀錄與刪除機制) ---
  const [foodLog, setFoodLog] = useState(() => {
    try {
      const saved = localStorage.getItem('nutriscan_log');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  const [history, setHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('nutriscan_history');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  const [dailyLimit, setDailyLimit] = useState(() => {
    const saved = localStorage.getItem('nutriscan_limit');
    return saved ? Number(saved) : 2000;
  });

  const [view, setView] = useState('today');
  const [expandedDayId, setExpandedDayId] = useState(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

  // 📸 新增：改為圖片陣列，支援多張
  const [images, setImages] = useState([]); 
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [isEditingLimit, setIsEditingLimit] = useState(false);

  const cameraInputRef = useRef(null);
  const uploadInputRef = useRef(null);
  const resultRef = useRef(null);

  // 計算今日營養總和
  const currentCalories = foodLog.reduce((acc, item) => acc + item.calories, 0);
  const currentProtein = foodLog.reduce((acc, item) => acc + (item.nutrients?.protein || 0), 0);
  const currentFat = foodLog.reduce((acc, item) => acc + (item.nutrients?.fat || 0), 0);
  const currentCarbs = foodLog.reduce((acc, item) => acc + (item.nutrients?.carbs || 0), 0);

  useEffect(() => {
    localStorage.setItem('nutriscan_log', JSON.stringify(foodLog));
    localStorage.setItem('nutriscan_limit', dailyLimit.toString());
    localStorage.setItem('nutriscan_history', JSON.stringify(history));
  }, [foodLog, dailyLimit, history]);

  const nutrientGoals = {
    carbs: Math.round((dailyLimit * 0.5) / 4),
    fat: Math.round((dailyLimit * 0.3) / 9),
    protein: Math.round((dailyLimit * 0.2) / 4),
  };

  const deleteItem = (id) => {
    if (window.confirm('確定要刪除這筆紀錄嗎？')) {
      setFoodLog(prev => prev.filter(item => item.id !== id));
      // 若刪除的是當前分析結果，清空畫面
      if (result && result.id === id) {
        setResult(null);
        setImages([]);
      }
    }
  };

  const deleteHistoryItem = (e, id) => {
    e.stopPropagation();
    if (window.confirm('確定要永久刪除這天的紀錄嗎？')) {
      setHistory(prev => prev.filter(item => item.id !== id));
    }
  };

  // 新增：移除單張預覽圖
  const removeImage = (indexToRemove) => {
    setImages(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  const saveAndStartNewDay = () => {
    if (foodLog.length === 0) { alert("今天還沒有紀錄喔！"); return; }
    if (window.confirm('確定要結算今日並存檔嗎？')) {
      const todaySummary = {
        id: Date.now(),
        date: new Date().toLocaleDateString(),
        totalCalories: currentCalories,
        limit: dailyLimit,
        nutrients: { p: currentProtein, f: currentFat, c: currentCarbs },
        goals: nutrientGoals, 
        foodList: foodLog.map(f => f.foodName),
        isOverLimit: currentCalories > dailyLimit
      };
      setHistory(prev => [todaySummary, ...prev]);
      setFoodLog([]);
      setResult(null);
      setImages([]);
      setView('history');
      setShowAllHistory(false);
    }
  };

  const toggleHistoryItem = (id) => {
    if (expandedDayId === id) setExpandedDayId(null);
    else setExpandedDayId(id);
  };

  const SHOW_LIMIT = 3; 
  const visibleHistory = showAllHistory ? history : history.slice(0, SHOW_LIMIT);

  // 壓縮圖片
  const compressImage = (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const MAX_WIDTH = 800; 
          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.7).split(',')[1]);
        };
      };
    });
  };

  // 🚀 新增：批次分析核心邏輯
  const analyzeFoodBatch = async () => {
    if (images.length === 0) return;
    if (!API_KEY) { setErrorMsg("❌ 找不到 API Key"); return; }
    
    setLoading(true); setResult(null); setErrorMsg("");

    try {
      const genAI = new GoogleGenerativeAI(API_KEY);
      const model = genAI.getGenerativeModel({ model: MODEL_NAME });

      // 準備多張圖片資料
      const imageParts = await Promise.all(images.map(async (imgObj) => {
        const base64 = await compressImage(imgObj.file);
        return { inlineData: { data: base64, mimeType: "image/jpeg" } };
      }));

      // 更新 Prompt 以支援多圖總結
      const prompt = `你是一位專業營養師。這裡有 ${images.length} 張食物照片，它們屬於「同一餐」。
      請綜合分析這些照片，計算這頓餐的「總熱量」與「總營養」。
      
      【用戶背景】
      - 每日熱量限制：${dailyLimit} kcal
      - 目前已攝取：${currentCalories} kcal

      【任務要求】
      1. 請嚴格回傳純 JSON 格式。
      2. foodName 請給出一個組合名稱，例如「雞腿便當配咖啡」或「牛肉麵與小菜」。
      3. 格式如下：
      {
        "foodName": "組合餐名稱",
        "calories": 數字(總和),
        "nutrients": { "protein": 數字, "fat": 數字, "carbs": 數字 },
        "portionAdvice": "針對這整頓餐的份量建議",
        "liverRisk": { "level": "低/中/高", "message": "脂肪肝風險評估" },
        "warning": boolean,
        "advice": "整體建議 (30字內)"
      }`;

      // 發送多圖請求
      const result = await model.generateContent([prompt, ...imageParts]);
      const rawText = (await result.response).text();
      
      let jsonString = rawText.replace(/```json|```/g, '').trim();
      const firstBrace = jsonString.indexOf('{');
      const lastBrace = jsonString.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) jsonString = jsonString.substring(firstBrace, lastBrace + 1);
      
      const data = JSON.parse(jsonString);
      const newRecord = { 
        ...data, 
        id: Date.now(), 
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 
        // 紀錄僅存第一張圖作為代表
        imgUrl: images[0].url 
      };

      setResult(newRecord); 
      setFoodLog(prev => [...prev, newRecord]);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 100);

    } catch (error) {
      console.error(error);
      let msg = error.message || "";
      if (msg.includes("404")) setErrorMsg(`模型設定錯誤 (404)，請檢查 API Key。`);
      else if (msg.includes("JSON")) setErrorMsg("資料解析失敗，請重試");
      else setErrorMsg(`分析失敗: ${msg}`);
    } finally { 
      setLoading(false); 
    }
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      const newImages = files.map(file => ({
        file,
        url: URL.createObjectURL(file)
      }));
      setImages(prev => [...prev, ...newImages]); // 追加模式
    }
    e.target.value = '';
  };

  const progressPercent = Math.min((currentCalories / dailyLimit) * 100, 100);
  const isOverLimit = currentCalories > dailyLimit;

  const getNutrientColor = (current, goal, type) => {
     if (!goal) return "text-slate-400";
     if (type === 'p') {
        if (current < goal * 0.8) return "text-orange-500 font-bold";
        if (current > goal * 1.5) return "text-rose-500 font-bold";
        return "text-emerald-500 font-bold";
     }
     if (current > goal * 1.1) return "text-rose-500 font-bold";
     return "text-emerald-500 font-bold";
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB] bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-green-100/50 via-blue-50/30 to-white font-sans text-slate-800 flex justify-center items-start pt-6 sm:pt-12 pb-32 px-4">
      <div className="w-full max-w-md bg-white/80 backdrop-blur-xl rounded-[40px] shadow-[0_30px_60px_-15px_rgba(0,0,0,0.1)] border border-white/60 relative overflow-hidden min-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 bg-white/50 backdrop-blur-md sticky top-0 z-20 border-b border-white/50">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-black tracking-tight flex items-center gap-2 cursor-pointer" onClick={() => setView('today')}>
              <div className="w-8 h-8 bg-gradient-to-tr from-emerald-400 to-teal-300 rounded-full flex items-center justify-center text-white shadow-lg">
                <Leaf size={16} fill="currentColor" />
              </div>
              <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">NutriScan</span>
            </h1>
            <button onClick={() => setView(view === 'today' ? 'history' : 'today')} className={`p-2 rounded-full transition-colors ${view === 'history' ? 'bg-emerald-100 text-emerald-600' : 'text-slate-400 hover:bg-slate-100'}`}>
              {view === 'today' ? <CalendarDays size={20} /> : <ArrowLeft size={20} />}
            </button>
          </div>

          {view === 'today' && (
            <div className="bg-white/60 rounded-2xl p-3 border border-white shadow-sm transition-all hover:shadow-md">
              <div className="flex justify-between items-end text-xs font-bold text-slate-500 mb-2 px-1">
                <span>今日攝取 {currentCalories} kcal</span>
                <div className="flex items-center gap-2">
                  {isEditingLimit ? (
                    <div className="flex items-center gap-2 animate-fade-in-up">
                      <input type="number" value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} className="w-20 bg-white border border-emerald-200 rounded-xl px-2 py-1.5 text-center text-lg text-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-400 shadow-sm" autoFocus />
                      <button onClick={() => setIsEditingLimit(false)} className="p-2 bg-emerald-500 text-white rounded-xl shadow-md hover:bg-emerald-600 active:scale-95 transition-all"><Check size={18} /></button>
                    </div>
                  ) : (
                    <button onClick={() => setIsEditingLimit(true)} className="flex items-center gap-1 group py-1">
                      <span className={isOverLimit ? "text-rose-500 font-bold text-sm" : "text-slate-400 group-hover:text-emerald-600 text-sm"}>{dailyLimit} kcal</span>
                      <Edit3 size={14} className="text-slate-300 group-hover:text-emerald-500" />
                    </button>
                  )}
                </div>
              </div>
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden shadow-inner relative mb-3">
                <div className={`h-full rounded-full transition-all duration-1000 ease-out shadow-sm ${isOverLimit ? 'bg-gradient-to-r from-rose-400 to-red-500' : 'bg-gradient-to-r from-emerald-400 to-teal-400'}`} style={{ width: `${progressPercent}%` }}></div>
              </div>
              <div className="flex gap-3 px-1">
                 {[['蛋', nutrientGoals.protein, 'bg-violet-400'], ['脂', nutrientGoals.fat, 'bg-amber-400'], ['碳', nutrientGoals.carbs, 'bg-emerald-400']].map(([label, val, color], i) => (
                   <div key={i} className="flex items-center gap-1"><div className={`w-2 h-2 rounded-full ${color}`}></div><span className="text-[10px] font-bold text-slate-400">{label} {val}g</span></div>
                 ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-6 space-y-6 flex-1 overflow-y-auto pb-32">
          {view === 'history' ? (
            <div className="space-y-4 animate-fade-in-up">
              {/* History View Logic */}
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-2">History Log {showAllHistory ? '(全部)' : `(近${SHOW_LIMIT}筆)`}</h3>
              {history.length === 0 ? <div className="text-center py-10 text-slate-300 text-sm">暫無歷史紀錄</div> : visibleHistory.map((day) => (
                 <div key={day.id} onClick={() => toggleHistoryItem(day.id)} className={`bg-white rounded-2xl border transition-all cursor-pointer overflow-hidden ${expandedDayId === day.id ? 'border-emerald-200 shadow-md ring-1 ring-emerald-100' : 'border-slate-100 shadow-sm hover:border-emerald-100'}`}>
                    <div className="p-5 flex justify-between items-center bg-white relative z-10">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold ${day.isOverLimit ? 'bg-rose-400' : 'bg-emerald-400'}`}>{Math.round((day.totalCalories / day.limit) * 100)}%</div>
                        <div>
                          <div className="flex items-center gap-2"><span className="font-bold text-slate-700">{day.date}</span><span className="text-[10px] text-slate-400 font-medium bg-slate-50 px-2 py-0.5 rounded-full">{day.totalCalories} kcal</span></div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{expandedDayId === day.id ? '點擊收合詳情' : `吃了 ${day.foodList.length} 餐...`}</div>
                        </div>
                      </div>
                      <div className="text-slate-300">{expandedDayId === day.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}</div>
                    </div>
                    {/* Expanded History Details */}
                    {expandedDayId === day.id && (
                      <div className="bg-slate-50/50 p-5 pt-0 border-t border-slate-100 animate-fade-in-up">
                         <div className="mt-3 space-y-2"><p className="text-xs font-bold text-slate-400 uppercase tracking-wider">攝取清單</p><p className="text-sm text-slate-700 leading-relaxed">{day.foodList.join("、")}</p></div>
                         <div className="flex justify-end mt-4 pt-3 border-t border-slate-200/50">
                            <button onClick={(e) => deleteHistoryItem(e, day.id)} className="flex items-center gap-1.5 text-[11px] font-bold text-rose-400 hover:text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-lg transition-colors"><Trash2 size={14} /> 刪除紀錄</button>
                         </div>
                      </div>
                    )}
                 </div>
              ))}
              {history.length > SHOW_LIMIT && (
                 <button onClick={() => setShowAllHistory(!showAllHistory)} className="w-full py-3 text-xs font-bold text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors flex items-center justify-center gap-2">
                   {showAllHistory ? <ArrowUpFromLine size={14} /> : <Archive size={14} />} {showAllHistory ? `收合清單` : `查看更早紀錄`}
                 </button>
              )}
            </div>
          ) : (
            <>
              {/* 📸 多圖預覽區塊 */}
              <div className="relative w-full aspect-[4/3] bg-gradient-to-br from-slate-50 to-slate-100 rounded-[32px] overflow-hidden border-4 border-white shadow-2xl shadow-slate-200/50 group flex flex-col">
                
                {images.length > 0 ? (
                  <div className="flex-1 relative w-full h-full overflow-hidden">
                    <div className="w-full h-full p-2 grid grid-cols-2 gap-2 overflow-y-auto content-start">
                       {images.map((img, idx) => (
                         <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border border-slate-200 group/img">
                            <img src={img.url} className="w-full h-full object-cover" />
                            {!result && <button onClick={() => removeImage(idx)} className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1 hover:bg-rose-500"><X size={12}/></button>}
                         </div>
                       ))}
                       {!result && !loading && (
                         <button onClick={() => uploadInputRef.current.click()} className="aspect-square rounded-xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 hover:border-emerald-400 hover:text-emerald-500 transition-colors bg-white/50">
                            <Plus size={24} />
                            <span className="text-[10px] font-bold mt-1">加菜</span>
                         </button>
                       )}
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-5">
                    <button onClick={() => cameraInputRef.current.click()} className="flex flex-col items-center gap-2 group/btn relative">
                      <div className="absolute inset-0 bg-emerald-400 blur-2xl opacity-20 group-hover/btn:opacity-40 transition-opacity rounded-full"></div>
                      <div className="w-16 h-16 bg-white rounded-2xl shadow-lg flex items-center justify-center text-emerald-500 group-hover/btn:scale-105 border border-emerald-50 z-10"><Camera size={32} /></div>
                      <span className="text-sm font-bold text-slate-600">拍攝第一道菜</span>
                    </button>
                    <div className="flex items-center gap-3 w-3/4 opacity-30"><div className="h-[1px] bg-slate-400 flex-1"></div><span className="text-[10px] font-bold">OR</span><div className="h-[1px] bg-slate-400 flex-1"></div></div>
                    <button onClick={() => uploadInputRef.current.click()} className="flex flex-col items-center gap-2 group/btn">
                      <div className="w-12 h-12 bg-white rounded-xl shadow-md flex items-center justify-center text-blue-400 group-hover/btn:scale-105 border border-blue-50"><ImageIcon size={20} /></div>
                      <span className="text-xs font-bold text-slate-400">相簿多張選取</span>
                    </button>
                  </div>
                )}

                {/* 分析按鈕 */}
                {images.length > 0 && !result && !loading && (
                  <div className="absolute bottom-4 left-0 w-full px-4 z-20">
                     <button onClick={analyzeFoodBatch} className="w-full bg-emerald-500 text-white h-12 rounded-full font-bold shadow-lg flex items-center justify-center gap-2 hover:bg-emerald-600 transition-all active:scale-95">
                        <Sparkles size={18} fill="currentColor" /> 開始分析 ({images.length}道菜)
                     </button>
                  </div>
                )}

                {loading && (
                  <div className="absolute inset-0 bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center z-30">
                    <Sparkles className="text-emerald-500 animate-spin mb-2" size={32} />
                    <p className="text-emerald-600 text-xs font-bold animate-pulse tracking-widest">AI 正在分析 {images.length} 道菜...</p>
                  </div>
                )}
              </div>

              {/* 隱藏輸入框：加入 multiple 屬性 */}
              <input type="file" accept="image/*" capture="environment" ref={cameraInputRef} onChange={handleFileSelect} className="hidden" />
              <input type="file" accept="image/*" multiple ref={uploadInputRef} onChange={handleFileSelect} className="hidden" />

              {errorMsg && (
                <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl animate-shake shadow-sm flex gap-3 items-center text-rose-500 text-xs font-bold"><Info size={16} /><span className="flex-1">{errorMsg}</span></div>
              )}

              {/* 今日紀錄列表 */}
              {foodLog.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-2">Today's Log</h3>
                  {foodLog.slice().reverse().map((item) => (
                    <div key={item.id} className={`bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex items-center justify-between group transition-all ${result?.id === item.id ? 'ring-2 ring-emerald-400 shadow-emerald-100' : ''}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${item.warning ? 'bg-orange-400' : 'bg-emerald-400'}`}>{item.calories}</div>
                        <div>
                          <p className="text-sm font-bold text-slate-700">{item.foodName}</p>
                          <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold">
                            {item.timestamp}
                            {item.liverRisk?.level === '高' && <span className="text-rose-500 flex items-center gap-0.5"><Activity size={10}/> 脂肪肝風險</span>}
                          </div>
                        </div>
                      </div>
                      <button onClick={() => deleteItem(item.id)} className="p-2 text-slate-300 hover:text-rose-500 transition-colors"><Trash2 size={16} /></button>
                    </div>
                  ))}
                </div>
              )}

              {/* 分析結果卡片 */}
              <div ref={resultRef}>
                {result && (
                  <div className="space-y-5 animate-fade-in-up py-4 border-t border-dashed border-slate-200 mt-4">
                    <div className="flex items-center justify-center gap-2 text-emerald-600 font-bold text-sm px-2 animate-bounce"><ChevronDown size={16} /> 分析結果</div>
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                        <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">套餐份量建議</h4>
                        <p className="text-sm font-bold text-slate-700 leading-relaxed">{result.portionAdvice}</p>
                    </div>
                    {result.liverRisk && (
                        <div className={`rounded-xl p-4 border flex gap-3 ${result.liverRisk.level === '高' ? 'bg-rose-50 border-rose-100 text-rose-700' : 'bg-emerald-50 border-emerald-100 text-emerald-700'}`}>
                            <div className="mt-0.5"><Activity size={16} /></div>
                            <div>
                                <p className="text-xs font-bold mb-1 opacity-80">脂肪肝風險: {result.liverRisk.level}</p>
                                <p className="text-xs font-bold">{result.liverRisk.message}</p>
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                      {[result.nutrients.protein, result.nutrients.fat, result.nutrients.carbs].map((val, i) => (
                          <div key={i} className="bg-white p-3 rounded-2xl text-center border border-slate-100 shadow-sm">
                            <span className="block text-lg font-black text-slate-700">{val}g</span>
                            <span className="text-[10px] text-slate-400 font-bold">{['蛋白質', '脂肪', '碳水'][i]}</span>
                          </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* 免責聲明 */}
          <div className="pt-8 border-t border-slate-200/50">
            <div className="flex gap-3 items-start opacity-70 px-2">
                <ShieldAlert size={16} className="text-slate-400 shrink-0 mt-0.5" />
                <p className="text-[10px] text-slate-400 leading-relaxed text-justify">
                    <span className="font-bold">免責聲明：</span>本應用程式僅提供 AI 輔助之熱量與飲食建議，<span className="font-bold">並非醫療診斷</span>。
                </p>
            </div>
          </div>
        </div>
        
        {/* 底部按鈕區 */}
        {view === 'today' && foodLog.length > 0 && !result && (
          <div className="fixed bottom-0 left-0 w-full bg-white/80 backdrop-blur-md border-t border-slate-200 p-4 z-40 animate-fade-in-up flex justify-center">
             <div className="w-full max-w-md flex gap-3">
               <button onClick={saveAndStartNewDay} className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-500 text-white h-14 rounded-full font-bold shadow-lg shadow-emerald-200 hover:shadow-emerald-300 transition-all flex items-center justify-center gap-2 text-lg active:scale-95">
                 <Save size={20} /> 結算今日並存檔
               </button>
             </div>
          </div>
        )}

        {/* 繼續下一餐按鈕 */}
        {result && view === 'today' && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-[calc(100%-3rem)] sm:max-w-xs z-50 animate-fade-in-up">
            <button onClick={() => { setResult(null); setImages([]); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="w-full bg-slate-900 text-white h-14 rounded-full font-bold shadow-2xl flex items-center justify-center gap-2">
              <RotateCcw size={18} /> 繼續記錄下一餐
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
