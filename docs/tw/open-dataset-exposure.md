# 開放資料集曝光檢查（開源 LLM 訓練）

開源與開放權重模型多半使用公開網頁資料集訓練。網站內容一旦被這類爬蟲收錄，可能被任何人下載使用，之後再撤回也無法從已發布的資料集移除。

## 系統可以觀察到的

抓取目的分頁中的「資料集曝光」欄會標記：

| 爬蟲 | 標記 | 依據 |
| --- | --- | --- |
| `CCBot`（Common Crawl） | 開放資料集 | Common Crawl 公開發布爬取結果，廣泛用於模型訓練（https://commoncrawl.org/ccbot） |
| `AI2Bot`（Ai2） | 開放資料集 | 官方說明內容用於訓練開放語言模型（https://allenai.org/crawler） |
| GPTBot、ClaudeBot、MistralAI-Training 等（SBIntuitionsBot 待併入） | 營運方模型訓練 | 目錄類型為訓練，資料用於營運方自己的模型 |
| `Bytespider` | 營運方模型訓練（證據等級 observed） | 字節跳動官方說明無法取得 |

Diffbot 官方說明不用於生成式 AI 基礎模型訓練；Webz.io（Omgili 後繼）會把資料標記為可否用於 AI/ML 並銷售，但沒有公開 UA，未建立規則（見 [UNVERIFIED.md](UNVERIFIED.md)）。Cohere 官方說明目前不以自有爬蟲收集訓練資料。

另可在「讀取 robots.txt / llms.txt 的爬蟲」中看到誰讀取了 `/ai.txt` 與 `/.well-known/tdmrep.json`。

## 系統無法量測、需要人工檢查的

本系統只收到瀏覽事件與存取日誌，**不會下載網頁 HTML 或回應標頭**，因此以下訊號沒有自動檢測，請用檢查清單逐頁確認：

| 檢查項目 | 做法 | 說明 |
| --- | --- | --- |
| robots.txt 排除開放資料集爬蟲 | `User-agent: CCBot` / `User-agent: AI2Bot` 加 `Disallow: /` | 可在「robots.txt 遵循檢查」貼上確認是否仍被抓取 |
| 排除營運方訓練但保留 AI 搜尋 | 分別設定 GPTBot 與 OAI-SearchBot、ClaudeBot 與 Claude-SearchBot、Google-Extended 與 Googlebot、Applebot-Extended 與 Applebot | 訓練與搜尋 token 分開 |
| TDMRep 文字與資料探勘保留 | HTTP 標頭 `tdm-reservation: 1`、`tdm-policy`；或 HTML `<meta name="tdm-reservation" content="1">`；或 `/.well-known/tdmrep.json` | W3C Community Group 最終報告（2024-05-10），不是 W3C 正式建議標準：https://www.w3.org/community/reports/tdmrep/CG-FINAL-tdmrep-20240510/ |
| `noai` / `noimageai` | `<meta name="robots" content="noai, noimageai">` | DeviantArt 2022 年提出的非標準慣例，是否遵守由各爬蟲決定 |
| ai.txt（Spawning） | 網站根目錄 `/ai.txt` | 廠商慣例；官方頁面為 JS，原文本次無法驗證 |
| llms.txt | `/llms.txt` 提供給 AI 的網站說明 | 社群提案（https://llmstxt.org/），**不控制抓取**，也不是退出機制 |
| 授權訊號 | `<link rel="license" href="…">`、CC 授權標示 | 授權條款決定他人可否合法再利用；請確認與 robots 設定一致 |
| 靜態 HTML 與 JS 渲染 | 用 `curl` 取回頁面，確認主要內容是否已在 HTML 中 | 多數資料集爬蟲不執行 JavaScript；只靠前端渲染的內容較不易被收錄，也較不易被 AI 搜尋引用 |
| 敏感內容 | 登入、付費牆、WAF 規則 | robots 只是偏好表達；需要強制時以存取控制處理 |

## 建議（依目標）

- **希望被 AI 搜尋引用、但不提供訓練**：允許 OAI-SearchBot、Claude-SearchBot、PerplexityBot、Googlebot、bingbot；封鎖 GPTBot、ClaudeBot、Google-Extended、Applebot-Extended、CCBot、AI2Bot；加上 TDMRep 保留聲明。
- **希望最大化曝光（包含開源模型）**：允許 CCBot 與 AI2Bot，提供靜態 HTML、清楚的授權標示與 llms.txt。
- **已公開的內容**：CCBot 過去已收錄的快照不會因現在封鎖而消失；封鎖只影響之後的抓取。
