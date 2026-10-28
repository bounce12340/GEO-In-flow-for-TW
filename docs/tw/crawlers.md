# AI 爬蟲與 AI 引薦目錄（依地區）

最後審閱：2026-10-28。本次新審閱的每一筆項目都對應營運方自己的官方文件（既有目錄中 Meta、字節跳動等少數條目仍以 Cloudflare 觀察目錄為依據，證據等級標為 observed）；查無官方文件、或文件沒有公開可驗證 UA 的項目不建立識別規則，改列於 [UNVERIFIED.md](UNVERIFIED.md)。

程式中的位置：

- 身份與識別規則：`src/lib/liekan/crawlers/registry.ts`（UA token = 身份名稱，依 token 邊界比對，不分大小寫）
- 營運方說明、官方來源網址、robots 說明：`src/lib/liekan/crawlers/catalog-metadata.ts`
- 地區、抓取目的、資料集曝光：`src/lib/liekan/crawlers/purpose.ts`
- AI 引薦網域：`config/liekan/ai-platform-coverage.json`；台灣引薦來源（**待接入**）：`src/lib/liekan/contracts/taiwan-sources.ts`
- 官方文件變動檢查：`pnpm liekan:crawlers:check-sources`（唯讀；待併入項目的文件網址在併入目錄後才納入檢查）

目的分類：訓練抓取（training_crawl）、AI 搜尋索引（ai_search_index）、使用者即時觸發（user_triggered_fetch）、Agent 代理瀏覽（agent_browsing）、傳統搜尋（traditional_search）、其他（other）、無法判定（unknown）。說明見 [crawl-purpose.md](crawl-purpose.md)。

### 「待併入」項目

標示為 **待併入** 的爬蟲與引薦網域已對照官方文件審閱完成，但**尚未啟用**。內建爬蟲目錄的版本被官方範例資料包（`scripts/liekan-demo-data/catalog.json`、manifest 與每筆合成規則）綁定；任何目錄變更都必須同時重新匯出範例資料包，並在獨立資料庫完成完整匯入驗收（`pnpm liekan:check-demo` 會檢查兩者一致）。本次工作環境沒有資料庫，因此這些項目以兩種方式提供：

1. 管理員可在系統的「爬蟲目錄」草稿流程中逐筆新增（含正反例預覽後發布），不需要修改程式碼或範例資料包。
2. 可直接套用的程式修改（registry、catalog-metadata、ai-platform-coverage 與測試數量更新，以及對應說明文字）隨交付報告提供，存放在 repo 外，不放進 repo 以免誤用。套用時須一併更新範例資料包。

抓取目的與地區對照（`purpose.ts`）已預先支援這些身份與平台，併入後即生效。

UA 只是請求自稱的身份。所有營運方文件都提醒 UA 可被偽造；可用時請搭配官方 IP 範圍或反查 DNS（系統的身份核驗結果另外顯示）。

## 台灣

台灣目前沒有本地營運方公開專屬 AI 爬蟲 UA。台灣大型語言模型（TAIDE、MediaTek Research Breeze、Taiwan-LLM）沒有公開爬蟲，見 [UNVERIFIED.md](UNVERIFIED.md)。

| 營運方 | 產品 | UA token | robots token | 目的 | 官方來源 |
| --- | --- | --- | --- | --- | --- |
| LY Corporation（LINE，日本公司；台灣 LINE 服務使用） | LINE 搜尋 | **待併入** `Linespider` | `Linespider` | 傳統搜尋（官方未提及 AI） | https://help2.line.me/linesearchbot/web/pc?lang=en |

台灣引薦來源（**待接入**）：對照表與測試已建立，但尚未接入引薦歸屬或任何畫面，目前不會顯示來源標籤。這些來源不是 AI 助理；接入後歸屬仍維持原本的「傳統搜尋 / 其他引薦」管道，只另外加上來源標籤。

| 來源 | 網域 | 類別 | 官方網址 |
| --- | --- | --- | --- |
| Yahoo奇摩搜尋 | tw.search.yahoo.com | 搜尋 | https://tw.search.yahoo.com/ |
| Yahoo奇摩 | tw.yahoo.com | 入口網站 | https://tw.yahoo.com/ |
| LINE TODAY | today.line.me | 新聞 | https://today.line.me/ |
| LINE | line.me | 通訊 | https://line.me/ |
| PChome 24h購物 | 24h.pchome.com.tw | 購物 | https://24h.pchome.com.tw/ |
| PChome Online | pchome.com.tw | 入口網站 | https://www.pchome.com.tw/ |
| Dcard | dcard.tw | 社群 | https://www.dcard.tw/robots.txt |
| PTT 批踢踢實業坊 | ptt.cc | 社群 | https://www.ptt.cc/ |
| 巴哈姆特電玩資訊站 | gamer.com.tw | 社群 | https://www.gamer.com.tw/ |

巴哈姆特的營運方是旺普網路資訊股份有限公司（Oneup Network Corporation）。依其公司沿革（https://www.oneup.com.tw/log.html），旺普網路資訊於 2000-02-24 成立，以經營「巴哈姆特」為主要營業內容。

Yahoo 全球說明頁表示 Yahoo 搜尋結果來自 Slurp 與 Bing 的爬蟲（https://help.yahoo.com/kb/SLN2213.html）。Yahoo奇摩搜尋（台灣）沒有找到官方的同類聲明。

## 全球 / 美國（預設優先顯示）

| 營運方 | UA token | robots token | 目的 | 官方來源 |
| --- | --- | --- | --- | --- |
| OpenAI | `GPTBot` | GPTBot | 訓練抓取 | https://developers.openai.com/api/docs/bots |
| OpenAI | `OAI-SearchBot` | OAI-SearchBot | AI 搜尋索引（ChatGPT 搜尋） | 同上 |
| OpenAI | `ChatGPT-User` | ChatGPT-User | 使用者即時觸發 | 同上 |
| OpenAI | `OAI-AdsBot` | — | 其他（廣告頁面安全檢查） | 同上 |
| Anthropic | `ClaudeBot` / `Claude-SearchBot` / `Claude-User` | 同名 | 訓練 / AI 搜尋 / 使用者觸發 | https://support.claude.com/en/articles/8896518 |
| Perplexity | `PerplexityBot` / `Perplexity-User` | 同名 | AI 搜尋 / 使用者觸發 | https://docs.perplexity.ai/guides/bots |
| Google | `Googlebot` | Googlebot | 傳統搜尋；AI 摘要（AI Overviews）與 AI 模式使用 Google 搜尋索引 | https://developers.google.com/search/docs/appearance/ai-features |
| Google | （無 HTTP UA）Google-Extended | Google-Extended | 控制 Gemini 訓練與 grounding，不影響搜尋收錄 | https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers |
| Google | `Google-CloudVertexBot` | 同名 | 其他（網站擁有者要求的 Vertex AI Agent 抓取） | 同上 |
| Google | **待併入** `Google-Agent` | 無（使用者觸發獲取器通常不適用 robots.txt） | Agent 代理瀏覽 | https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers |
| Google | **待併入** `Google-GeminiNotebook` | 無 | 使用者即時觸發 | 同上 |
| Microsoft | `bingbot` | bingbot | 傳統搜尋；Copilot 沒有官方公開的獨立 UA | https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0 |
| Apple | `Applebot`；（無 HTTP UA）Applebot-Extended | 同名 | 傳統搜尋；Applebot-Extended 控制 Apple 模型訓練 | https://support.apple.com/en-us/119829 |
| Amazon | `Amazonbot` / `Amzn-SearchBot` / `Amzn-User` | 同名 | 訓練 / AI 搜尋 / 使用者觸發 | https://developer.amazon.com/amazonbot |
| Meta | `Meta-ExternalAgent` / `Meta-ExternalFetcher` | — | 訓練 / 使用者觸發 | https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/ |
| Meta | **待併入** `Meta-WebIndexer` | Meta-WebIndexer | AI 搜尋索引（Meta AI） | 同上 |
| Meta | **待併入** `Meta-ExternalAds` | Meta-ExternalAds | 其他（廣告） | 同上 |
| Common Crawl | `CCBot` | CCBot | 訓練抓取（開放資料集） | https://commoncrawl.org/ccbot |
| Ai2 | `AI2Bot` | AI2Bot | 訓練抓取（開放模型） | https://allenai.org/crawler |
| Diffbot | **待併入** `Diffbot` | Diffbot | 其他（知識圖譜與網頁搜尋；官方稱不用於生成式 AI 基礎模型訓練） | https://www.diffbot.com/docs/crawl/faq/robots-txt |
| Diffbot | **待併入** `Diffbot-User` | Diffbot-User | 使用者即時觸發 | 同上 |
| Yahoo | **待併入** `Slurp`（UA 內為 `Yahoo! Slurp`） | Slurp | 傳統搜尋 | https://help.yahoo.com/kb/SLN22600.html |
| DuckDuckGo | `DuckDuckBot` / `DuckAssistBot` | 同名 | 傳統搜尋 / AI 回答即時抓取 | https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot |
| Ahrefs、Semrush | `AhrefsBot`、`SemrushBot` 等 | 同名 | 其他（SEO 工具） | https://ahrefs.com/robot、https://www.semrush.com/bot/ |

## 日本

| 營運方 | UA token | robots token | 目的 | 官方來源 |
| --- | --- | --- | --- | --- |
| SB Intuitions（SoftBank） | **待併入** `SBIntuitionsBot` | SBIntuitionsBot | 訓練抓取（AI 開發與資訊分析） | https://www.sbintuitions.co.jp/en/bot/ |
| SB Intuitions | **待併入** `SBIntuitions-SearchBot` | 官方未說明 | 使用者即時觸發（Sarashina；官方稱不用於 AI 開發） | 同上 |
| NICT | **待併入** `ICC-Crawler` | ICC-Crawler | 其他（研究，包含 AI 技術研究） | https://ucri.nict.go.jp/en/icccrawler.html |
| ROIS-DS | **待併入** `Cotoyogi` | Cotoyogi | 其他（日語資料研究；官方未說明 AI 用途） | https://ds.rois.ac.jp/center8/crawler/ |

LY Corporation（Yahoo! JAPAN）公開了 `Y!J-*` 系列名稱但沒有完整 UA，且說明 `!` 可能缺漏，未建立規則。NTT tsuzumi、Sakana AI 沒有公開爬蟲。

## 韓國

| 營運方 | UA token | robots token | 目的 | 官方來源 |
| --- | --- | --- | --- | --- |
| Naver | `Yeti` | Yeti | 傳統搜尋（Naver AI Briefing 使用 Naver 搜尋） | https://searchadvisor.naver.com/guide/seo-basic-robots |

Kakao / Daum 官方 FAQ 只提供 robots token `DAUM`，沒有 UA；`Daumoa` 只見於第三方網站，未建立規則。HyperCLOVA X 沒有公開獨立爬蟲。

## 歐洲

| 營運方 | UA token | robots token | 目的 | 官方來源 |
| --- | --- | --- | --- | --- |
| Mistral AI | `MistralAI-User` / `MistralAI-Index` / `MistralAI-Training` | 同名 | 使用者觸發 / AI 搜尋 / 訓練 | https://docs.mistral.ai/robots |
| Yandex | `YandexBot` | YandexBot | 傳統搜尋 | https://yandex.com/support/webmaster/en/robot-workings/check-yandex-robots.html |
| Yandex | **待併入** `YandexAdditionalBot` | YandexAdditional | AI 搜尋（決定內容可否出現在 Yandex AI 回答） | 同上 |
| Seznam、Qwant、Mojeek、Majestic | 既有條目 | — | 傳統搜尋 / SEO | 見 catalog-metadata.ts |

Aleph Alpha 沒有公開爬蟲文件。

## 中國大陸（保留，不作為預設優先）

既有的 Baiduspider、Sogou、360Spider、KimiBot / Kimi-SearchBot / Kimi-User、HySpider、Bytespider、PetalBot 全部保留。2026-10-28 複查時，Bytespider 與 HySpider 的官方頁面無法取得、PetalBot 官方頁面僅能載入空殼，詳見 [UNVERIFIED.md](UNVERIFIED.md)；它們原本的證據等級（observed / pending）沒有提高。

## AI 搜尋引薦網域

既有：chatgpt.com、chat.openai.com、claude.ai、perplexity.ai、gemini.google.com、copilot.microsoft.com、kimi.com、chat.deepseek.com、doubao.com、qianwen.com、chat.qwen.ai、yuanbao.tencent.com、yiyan.baidu.com 等。

已審核、待併入（2026-10-28 確認為營運方官方產品網域；原因同上，尚未加入 `ai-platform-coverage.json`）：

| 營運方 | 產品 | 網域 | 確認方式 |
| --- | --- | --- | --- |
| xAI | Grok | grok.com | 首頁 200，標題 "Grok" |
| Mistral AI | Vibe（原 Le Chat） | chat.mistral.ai | vibe.mistral.ai 轉址至此；help.mistral.ai 說明更名 |
| Meta | Meta AI | meta.ai（含 www） | https://www.meta.ai/robots.txt |
| 百度 | 文心助手 | wenxin.baidu.com | yiyan.baidu.com 轉址至此 |
| You.com | You.com | you.com | 首頁 200 |
| Quora | Poe | poe.com | https://poe.com/robots.txt（營運方為 Quora 僅有媒體報導佐證） |

ChatGPT 的引薦連結會加上 `utm_source=chatgpt.com`，即使 Referer 被移除，系統仍可依 UTM 歸屬。Brave Search（search.brave.com）同時是搜尋引擎與 AI 回答，未歸入 AI 引薦。
