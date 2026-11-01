# 尚未驗證、已淘汰或排除的項目

檢查日期：2026-10-28。以下項目沒有建立新的識別規則。原則：沒有營運方公開、可驗證的 UA 或文件，就不新增偵測規則。既有目錄條目不刪除，只在此說明其證據狀態。

| 項目 | 狀態 | 原因 |
| --- | --- | --- |
| `anthropic-ai`、`Claude-Web`（Anthropic） | 已淘汰 | Anthropic 目前的爬蟲說明頁不再列出。 |
| `FacebookBot`（Meta） | 已淘汰（目錄保留） | Meta 爬蟲頁已移除；目錄條目保留以讀取歷史紀錄。 |
| `Google-NotebookLM`、`google-speakr` | 已淘汰 | Google 標示 NotebookLM 支援至 2026 年 8 月、google-speakr 已棄用。 |
| `Bytespider`（字節跳動） | 未驗證（目錄保留，證據 observed） | 無法取得字節跳動官方頁面；第三方指向的 zhanzhang.toutiao.com 只有 JS 空殼。 |
| `TikTokSpider` | 未驗證 | 僅第三方目錄記載。 |
| `HySpider`（騰訊混元） | 未驗證（目錄保留） | 2026-10-28 的搜尋找不到騰訊官方文件。 |
| `PetalBot`（華為） | 官方頁面無法讀取（目錄保留 pending） | 官方頁面為純 JS，無法讀取內容。 |
| `PanguBot`（華為盤古） | 未驗證 | 僅第三方目錄記載。 |
| `Daumoa`（Kakao） | 未驗證 | 官方 Daum FAQ 只使用 robots token `DAUM`，沒有 UA。 |
| Naver `Yeti` 完整 UA | 部分驗證 | robots token 已驗證；完整 UA 字串所在官方頁面無法讀取。 |
| HyperCLOVA X / Naver AI 爬蟲、Kakao Kanana | 查無 | 沒有官方文件記載獨立爬蟲。 |
| xAI / Grok（`GrokBot`、`xAI-Grok` 等） | 未驗證 | 查無 xAI 官方文件，第三方說法互相矛盾。引薦網域 grok.com 已審閱、**待併入**（尚未啟用，見 [crawlers.md](crawlers.md)）。 |
| DeepSeek（`DeepSeekBot`） | 未驗證 | 查無官方文件。 |
| 豆包、通義千問爬蟲 | 查無 | 查無官方爬蟲頁。 |
| Cohere（`cohere-ai`、`cohere-training-data-crawler`） | 排除 | Cohere 官方說明目前不以 Cohere bot 爬取網頁訓練生成式 AI 基礎模型（https://docs.cohere.com/docs/cohere-web-crawlers）。 |
| You.com `YouBot` | 未驗證 | 查無爬蟲說明頁。 |
| Brave（`Bravebot`） | 無法以 UA 識別 | 官方說明 Brave Search 爬蟲不使用可區分的 UA（https://search.brave.com/help/brave-search-crawler）。 |
| Timpibot | 未驗證 | 僅第三方目錄記載。 |
| Omgili / `omgilibot` / `Webzio-Extended` | 部分驗證，未建立規則 | Webz.io 頁面（https://webz.io/bot.html）提到這些名稱，但沒有公開 UA 字串或 robots token。 |
| ImagesiftBot（Hive）、VelenPublicWebCrawler（Hunter） | 已驗證但本次未加入 | 官方頁面存在（https://imagesift.com/about、https://hunter.io/robot），與 GEO 關聯度較低，留待之後評估。 |
| LY Corp `Y!J-*` 系列 | 部分驗證，未建立規則 | 官方頁面（https://support.yahoo-net.jp/PccSearch/s/article/H000007955）只列名稱、沒有完整 UA，且說明 `!` 可能缺漏。 |
| Aleph Alpha、NTT tsuzumi、Sakana AI | 查無 | 沒有公開爬蟲文件。 |
| Qwantbot | 無法複查 | 官方頁面回應 HTTP 403。既有條目保留。 |
| Yahoo! JAPAN 搜尋使用 Google（2026 年） | 未驗證 | 只有 2010 年新聞，查無 LY Corp 現行說明。 |
| Yahoo奇摩搜尋由 Bing 提供 | 未驗證（台灣） | 只有 Yahoo 全球說明頁與媒體報導，沒有台灣官方聲明。 |
| Phind | 已停止服務（第三方報導） | 未取得第一方聲明，未加入引薦網域。 |

## 台灣大型語言模型

| 模型 | 結論 | 依據 |
| --- | --- | --- |
| TAIDE | 沒有公開爬蟲 | TAIDE 官方網站（https://taide.stpi.niar.org.tw/）：「訓練模型所使用的文本資料係經由TAIDE團隊與政府單位和民間出版社洽商，合法取得授權之資料。」 |
| MediaTek Research Breeze | 沒有公開爬蟲 | 模型卡（https://huggingface.co/MediaTek-Research/Breeze-7B-Instruct-v1_0）標示由 mistralai/Mistral-7B-v0.1 微調而來，沒有描述訓練資料或爬蟲。 |
| Taiwan-LLM（yentinglin） | 沒有公開爬蟲 | 模型卡（https://huggingface.co/yentinglin/Llama-3-Taiwan-70B-Instruct）說明以具名提供者的繁體中文與英文語料微調（例如 Taiwan AI Labs 媒體內容、Ubitus 遊戲內容），沒有記載爬蟲。 |

因此這些模型不會以自有身份出現在抓取紀錄中。它們的基礎模型（例如 Mistral、Llama）訓練資料來源不在本系統可觀察的範圍內，無法從日誌判斷網站內容是否被使用。
