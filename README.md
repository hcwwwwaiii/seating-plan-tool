# 同學各位找個位 — 觸控操作版

[使用網站](https://hcwwwwaiii.github.io/seating-plan-tool/)

以 [Sam Li 原版工具](https://seating-plan-tool-wslisam.pages.dev/) 的公開前端還原版本為基礎，保留 By Sam Li 署名。

- 點學生再點另一座位，交換或移到空位；電腦仍可拖曳。
- 觸控座位選單可鎖定、禁用及取消選取。
- 表格名單可編輯學生及勾選視力照顧、高個子。
- 每個方案可復原最多 30 次操作，重新整理後復原紀錄清除。
- 支援多方案、編排規則、PNG 匯出及 TXT 匯入匯出。

資料只保存在目前瀏覽器的 localStorage，沒有上傳學生名單。不同裝置或網址不會自動同步；請用 TXT 匯出／匯入轉移資料。

## 發布

純靜態網站，index.html 和 app.js 置於同一資料夾。GitHub Pages 由 gh-pages 分支的根目錄發布，無需安裝套件或建置。

JavaScript 語法及桌面瀏覽器的觸控尺寸操作檢查通過；尚未在實體 iPad／Safari 上測試。