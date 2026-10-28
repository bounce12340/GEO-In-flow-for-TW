# 快速開始（GEOInflow TW）

依「部署 → 接入 → 核對資料 → 開始分析」完成第一個網站。完整操作細節可參考原始文件 [docs/getting-started.md](../getting-started.md)（簡體中文）。

## 1. 啟動並登入

```sh
sh scripts/liekan-deploy.sh
```

服務健康後開啟 `http://127.0.0.1:3002`。首次安裝帳號 `admin`、初始密碼 `liekan`，請立即到帳戶設定變更密碼。

介面預設為繁體中文（台灣）。右上角語言選單可切換「繁體中文 / 简体中文 / English」，選擇會存在瀏覽器（`liekan.locale` Cookie），登出後保留。部署層級的預設語言由 `.env` 的 `DEFAULT_LOCALE` 決定（`zh-TW`、`zh-CN` 或 `en-US`）。

注意：證據匯出與歷史修復匯出的下載檔，在繁體中文介面下仍是簡體中文內容。資料表的語系限制只接受 `zh-CN` 與 `en-US`，本版不新增 migration，所以這兩種匯出沿用簡體中文檔案。

首次完整登入需確認國家與分析時區，預設分析時區為 `Asia/Taipei`。之後「今天」以該時區的自然日計算；週一至週日為一週。

## 2. 建立網站

在網站管理建立網站，填寫名稱與實際網域。瀏覽腳本、日誌來源、內容目錄、事件與目標都屬於特定網站。

## 3. 安裝瀏覽腳本

在網站設定的「資料接入」選擇 JS，複製產生的程式碼放進網站 `<head>`：

```html
<script defer src="https://stats.example.com/script.js" data-website-id="網站的 UUID"></script>
```

瀏覽採集預設不使用 Cookie。若要啟用工作階段錄製或事件屬性，請先依 [台灣個資法說明](taiwan-context.md#二個人資料保護法個資法) 更新隱私權政策。

## 4. 接入抓取日誌（AI 爬蟲觀察必需）

瀏覽腳本看不到 AI 爬蟲；請匯入伺服器或 CDN 存取日誌：手動匯入（Nginx / Apache Combined、JSON）、伺服器一次安裝或 Cloudflare 授權。

## 5. 看懂 AI 來訪

1. 網站分析 → AI 蜘蛛歸因與控制 → **抓取目的**：各 AI 的來訪目的、地區與來源。
2. 在「robots.txt 遵循檢查」貼上目前的 robots.txt，查看是否有爬蟲抓取禁止路徑。
3. 對照「使用者觸發獲取與 AI 引薦造訪」，找出使用者在 ChatGPT、Perplexity、Claude 等讀過、之後也帶來造訪的頁面。
4. 依 [開放資料集曝光檢查](open-dataset-exposure.md) 決定是否提供內容給開源模型訓練。

## 6. 範例資料

首次安裝會匯入官方範例「猎看官网（示例数据）」。範例資料是合成資料，與正式分析分開；可以刪除或清空，升級與重啟不會重建。
