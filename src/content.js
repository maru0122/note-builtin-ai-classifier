// ============================================================================
// 1. エントリーポイント & クリエイターID抽出
// ============================================================================
function extractCreatorId() {
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts.length >= 1) {
    const candidate = parts[0];
    const reserved = ["explore", "login", "signup", "settings", "notifications", "messages", "intent", "hashtag", "topic", "membership", "features"];
    if (!reserved.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

function initialize() {
  const creatorId = extractCreatorId();
  if (!creatorId) return;

  const isArticle = location.pathname.includes("/n/");
  const isAuthorPage = !isArticle && location.pathname.split("/").filter(Boolean).length === 1;

  if (!isArticle && !isAuthorPage) return;
  if (document.getElementById("note-ai-judge-container")) return;

  // 挿入先要素の探索
  const targetArea = document.querySelector("h1") || 
                     document.querySelector(".p-article__header") || 
                     document.querySelector(".o-creatorProfile") ||
                     document.querySelector("[data-name='creator-profile']") ||
                     document.querySelector("main header") ||
                     document.querySelector("main");
  if (!targetArea) return;

  createAndInjectWidget(targetArea, isArticle, creatorId);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}

let timer = null;
const observer = new MutationObserver(() => {
  if (timer) return;
  timer = setTimeout(() => {
    initialize();
    timer = null;
  }, 400);
});
observer.observe(document.body, { childList: true, subtree: true });

// ============================================================================
// 2. UI・ウィジェット構築
// ============================================================================
function createAndInjectWidget(targetArea, isArticle, creatorId) {
  const container = document.createElement("div");
  container.id = "note-ai-judge-container";

  const btnRow = document.createElement("div");
  btnRow.className = "note-ai-btn-row";

  let articleBtn = null;
  let resultCard = null;

  // 1. 既存の記事判定ボタン (記事ページのみ・完全維持)
  if (isArticle) {
    articleBtn = document.createElement("button");
    articleBtn.className = "note-ai-judge-btn";
    articleBtn.innerText = "✨ 内蔵AIで判定";

    resultCard = document.createElement("div");
    resultCard.className = "note-ai-result-card";
    resultCard.style.display = "none";

    articleBtn.addEventListener("click", async () => {
      const payload = extractArticleData();
      if (!payload) {
        alert("記事本文が短すぎるか、取得できませんでした。ページを再読み込みしてください。");
        return;
      }

      articleBtn.disabled = true;
      articleBtn.innerText = "⏳ Gemini Nano推論中...";
      resultCard.style.display = "block";
      resultCard.className = "note-ai-result-card loading";
      resultCard.innerHTML = "ブラウザ内蔵Gemini Nanoで分析中...";

      try {
        const resultData = await evaluateViaBackground(payload);
        renderResult(resultCard, resultData);
      } catch (err) {
        console.error(err);
        resultCard.className = "note-ai-result-card error";
        resultCard.innerHTML = `<strong>エラー:</strong> ${escapeHTML(err.message)}`;
      } finally {
        articleBtn.disabled = false;
        articleBtn.innerText = "✨ 内蔵AIで判定";
      }
    });

    btnRow.appendChild(articleBtn);
  }

  // 2. 著者情報から判定ボタン (客観ルール判定＋補助AI)
  const authorBtn = document.createElement("button");
  authorBtn.className = "note-ai-judge-btn note-ai-judge-btn-author";
  authorBtn.innerText = "👤 著者情報から判定";

  const authorResultCard = document.createElement("div");
  authorResultCard.className = "note-ai-result-card";
  authorResultCard.style.display = "none";

  authorBtn.addEventListener("click", async () => {
    authorBtn.disabled = true;
    authorBtn.innerText = "⏳ 著者データ分析中...";
    authorResultCard.style.display = "block";
    authorResultCard.className = "note-ai-result-card loading";
    authorResultCard.innerHTML = `著者 (@${creatorId}) の更新頻度・相互フォロー・マガジンを客観分析中...`;

    try {
      const resultData = await evaluateAuthorViaBackground(creatorId);
      renderResult(authorResultCard, resultData);
    } catch (err) {
      console.error(err);
      authorResultCard.className = "note-ai-result-card error";
      authorResultCard.innerHTML = `<strong>エラー:</strong> ${escapeHTML(err.message)}`;
    } finally {
      authorBtn.disabled = false;
      authorBtn.innerText = "👤 著者情報から判定";
    }
  });

  btnRow.appendChild(authorBtn);
  container.appendChild(btnRow);

  if (resultCard) {
    container.appendChild(resultCard);
  }
  container.appendChild(authorResultCard);

  targetArea.parentElement.insertBefore(container, targetArea.nextSibling);
}

// ============================================================================
// 3. DOM抽出処理 (記事) - 既存コード完全維持
// ============================================================================
function extractArticleData() {
  const bodyEl = document.querySelector(".p-article__content, [data-name='body'], .note-common-styles__textnote-body, article");
  if (!bodyEl) return null;

  const titleEl = document.querySelector("h1.o-noteContentText__title") || document.querySelector("h1");
  const title = titleEl ? titleEl.innerText.trim() : "";

  const headings = Array.from(bodyEl.querySelectorAll("h2, h3, h4"))
    .map(h => "- " + h.innerText.trim())
    .filter(text => text.length > 2);

  const introText = bodyEl.innerText.trim().slice(0, 800); 

  if (!introText || introText.length < 50) return null;

  return { title, headings, introText, url: location.href };
}

// ============================================================================
// 4. API通信 (記事 & 著者)
// ============================================================================
async function evaluateViaBackground(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "evaluate_article", payload }, (response) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (!response || !response.success) {
        return reject(new Error(response ? response.error : "バックグラウンドからの応答がありませんでした。"));
      }
      resolve(response.data);
    });
  });
}

async function evaluateAuthorViaBackground(creatorId) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "evaluate_author_rules", creatorId }, (response) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (!response || !response.success) {
        return reject(new Error(response ? response.error : "バックグラウンドからの応答がありませんでした。"));
      }
      resolve(response.data);
    });
  });
}

// ============================================================================
// 5. UI描画・簡易Markdownレンダラー
// ============================================================================
function renderResult(cardEl, data) {
  const colorMap = {
    "green": "card-green",
    "yellow": "card-yellow",
    "red": "card-red",
    "unknown": "card-unknown"
  };
  const statusClass = colorMap[data.color] || "card-unknown";

  cardEl.className = `note-ai-result-card ${statusClass}`;
  
  cardEl.innerHTML = `
    <div class="note-ai-result-title">${escapeHTML(data.titleText)}</div>
    <div class="note-ai-result-body markdown-body">
      ${parseSimpleMarkdown(data.bodyText)}
    </div>
    <details class="note-ai-raw-details">
      <summary>分析の詳細データを見る</summary>
      <pre>${escapeHTML(data.rawText)}</pre>
    </details>
  `;
}

function parseSimpleMarkdown(text) {
  let html = escapeHTML(text);
  
  html = html.replace(/^##\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^#\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/^- (.*)$/gm, '<li>$1</li>');
  
  html = html.replace(/(<li>.*?<\/li>(?:\n<li>.*?<\/li>)*)/g, '<ul>$1</ul>');

  html = html.replace(/\n/g, '<br/>');
  html = html.replace(/<\/h3><br\/>/g, '</h3>');
  html = html.replace(/<\/ul><br\/>/g, '</ul>');
  
  return html;
}

function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
