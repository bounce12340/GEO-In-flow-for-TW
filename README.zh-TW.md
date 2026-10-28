# GEOInflow TW

[English](README.md) | [简体中文](README.zh-CN.md) | **繁體中文（台灣）**

面向 GEO（生成式引擎最佳化）的自架網站與 AI 爬蟲分析系統，台灣在地化版本。

**原始專案聯合發布：猎看科技 · 北京日报社智源GEO**
**GEOInflow TW：台灣在地化改編，Josh Tsai**

GEOInflow TW 以 GEOInflow v1.2（工程版本 1.2.0，Umami 的 MIT 衍生作品）為基礎，保留原有授權、著作權聲明與署名，增加以下台灣在地化內容：

- 繁體中文（台灣用語）介面，並設為未指定語言時的預設語言；簡體中文與 English 仍可切換。
- 預設分析時區 `Asia/Taipei`；`Asia/Shanghai` 等其他時區仍可選擇。
- 國家統計把台灣列為獨立國家代碼 `TW`，縣市使用 ISO 3166-2:TW 代碼；舊資料在查詢時轉換（見 `docs/geography.md`）。
- 依地區整理的 AI 爬蟲與 AI 引薦目錄（台灣、全球 / 美國、日本、韓國、歐洲、中國大陸）。新審閱的項目都附營運方官方文件網址，其中新增身份「待併入」內建目錄（需同時更新官方範例資料包，見 docs/tw/crawlers.md）。
- 「抓取目的」分析：依目錄判定訓練抓取、AI 搜尋索引、使用者即時觸發、Agent 代理瀏覽、傳統搜尋或無法判定，並對照 robots.txt / llms.txt 與 AI 引薦造訪。
- 開放資料集曝光檢查清單、台灣個資法與人工智慧基本法說明、台灣搜尋與 AI 環境文件。
- 部署預設使用全球官方來源；需要區域鏡像時可透過環境變數選擇使用。

應用程式原始碼採 [MIT 授權](LICENSE)，第三方授權見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 文件

| 主題 | 文件 |
| --- | --- |
| 快速開始 | [docs/tw/quick-start.md](docs/tw/quick-start.md) |
| 部署（從台灣部署） | [docs/tw/deployment.md](docs/tw/deployment.md) |
| AI 爬蟲與引薦目錄（依地區） | [docs/tw/crawlers.md](docs/tw/crawlers.md) |
| 抓取目的分析 | [docs/tw/crawl-purpose.md](docs/tw/crawl-purpose.md) |
| 開放資料集曝光檢查 | [docs/tw/open-dataset-exposure.md](docs/tw/open-dataset-exposure.md) |
| 台灣情境：繁簡訊號、個資法、AI 基本法、搜尋環境 | [docs/tw/taiwan-context.md](docs/tw/taiwan-context.md) |
| 尚未能驗證的爬蟲與來源 | [docs/tw/UNVERIFIED.md](docs/tw/UNVERIFIED.md) |
| 原始專案文件（簡體中文） | [docs/README.md](docs/README.md) |

## 快速部署

需要已啟動的 Docker Engine / Docker Desktop 與 Docker Compose V2。在專案根目錄執行：

```sh
sh scripts/liekan-deploy.sh
```

首次執行會產生私有 `.env`（`DEFAULT_LOCALE=zh-TW`）與隨機金鑰，建置映像、執行遷移、匯入官方範例資料，並啟動服務。預設網址：

```text
http://127.0.0.1:3002
```

首次安裝的初始帳號為 `admin`，初始密碼為 `liekan`，登入後請立即變更密碼。既有安裝的 `.env` 與帳號密碼在升級時保留；若 `.env` 內已有 `DEFAULT_LOCALE=zh-CN`，會繼續使用簡體中文預設，可自行改為 `zh-TW`。

## 能做什麼

| 問題 | 可查看的內容 |
| --- | --- |
| 哪些 AI 來過網站？為什麼來？ | 爬蟲身份、營運方、地區、抓取目的、來源、核驗狀態 |
| 哪些頁面與內容類型吸引哪些 AI？ | 頁面 × 目的、內容類型（網頁、文件、圖片、robots.txt、llms.txt 等）× 目的 |
| AI 是否讀取並遵循 robots.txt？ | 讀取 robots.txt / llms.txt 的爬蟲、命中禁止路徑的請求（需提供 robots.txt） |
| 使用者在 AI 產品裡讀過的頁面，同一期間也有 AI 引薦造訪嗎？ | 使用者觸發抓取與 AI 引薦落地頁在同一期間的共同出現（非因果） |
| 內容是否可能流入開放模型訓練資料？ | Common Crawl、Ai2 等開放資料集爬蟲標記與檢查清單 |

抓取紀錄只能說明觀察到的造訪行為；收錄、模型訓練、回答引用與帶來的業務成效需要各自的證據。
