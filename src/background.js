// --- プロンプト定数・デフォルト定義 (既存維持) ---
export const DEFAULT_PROMPT = {
  system: "あなたはnote記事の客観的な分析アシスタントです。指定された色判定ルールと出力フォーマットに厳密に従ってください。",
  userTemplate: `以下のnote記事の冒頭と構成を分析し、記事の属性を客観的に判定してください。

## 判定基準（色）
- 【判定色: 緑】: 独自の検証データ、具体的な実体験、創作活動など（一次情報度：高）
- 【判定色: 黄】: 一般的な体験談、まとめ記事、考察など（一次情報度：中）
- 【判定色: 赤】: ネット情報の抽象的なまとめ、コピペ、過度な商材誘導など（一次情報度：低）

## 出力フォーマット
必ず以下の構成で出力してください。見出しはMarkdown(##)を使ってください。

【判定色】: [緑 / 黄 / 赤]
## 分析結果
- **記事タイプ**: (実践ノウハウ / エッセイ / 考察 / ツール紹介 / 日記)
- **判定理由**: (なぜその判定色にしたのか、1〜2文で記述)
- **要約**: (記事の主旨を1行で)
- **特徴**: (記事の客観的な特徴)

記事データ:
{{articleData}}`
};

// 拡張機能アイコンクリック時にサイドパネルを開く設定
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// --- メッセージリスナー ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 既存: 記事のAI判定
  if (request.action === "evaluate_article") {
    handleEvaluation(request.payload)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 新規: 著者の客観データ取得＆総合判定
  if (request.action === "evaluate_author_rules") {
    handleAuthorRuleEvaluation(request.creatorId)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// --- AI 実行メインロジック (記事判定・既存完全維持) ---
async function handleEvaluation(payload) {
  const headingsText = payload.headings.length > 0 ? payload.headings.join("\n") : "（見出しなし）";
  const payloadText = `【タイトル】\n${payload.title}\n\n【見出し一覧】\n${headingsText}\n\n【本文冒頭】\n${payload.introText}`;

  const promptConfig = await getActivePrompt();
  const rawOutput = await callBuiltInAI(payloadText, promptConfig);

  return parseAIOutput(rawOutput);
}

// --- 著者 客観ルールベース判定 (JSによるミリ秒・確実判定) ---
async function handleAuthorRuleEvaluation(creatorId) {
  // 1. RSSフィードと著者ページHTMLを並行取得
  const rssUrl = `https://note.com/${encodeURIComponent(creatorId)}/rss`;
  const authorUrl = `https://note.com/${encodeURIComponent(creatorId)}`;

  const [rssRes, authorRes] = await Promise.allSettled([
    fetch(rssUrl).then(r => r.ok ? r.text() : ""),
    fetch(authorUrl).then(r => r.ok ? r.text() : "")
  ]);

  const rssXml = rssRes.status === "fulfilled" ? rssRes.value : "";
  const authorHtml = authorRes.status === "fulfilled" ? authorRes.value : "";

  if (!rssXml && !authorHtml) {
    throw new Error(`著者 (@${creatorId}) のデータを取得できませんでした。`);
  }

  // 2. ルールベース分析の実行 (ミリ秒で即座に完了)
  const analysis = runObjectiveAnalysis(creatorId, rssXml, authorHtml);

  return formatAuthorResult(analysis);
}

// 客観的データ（頻度、相互フォロー、マガジンセクション、タイトル）の計算ロジック
function runObjectiveAnalysis(creatorId, rssXml, htmlStr) {
  // ① RSSパース
  const itemMatches = rssXml.match(/<item>[\s\S]*?<\/item>/g) || [];
  const items = [];

  for (const itemXml of itemMatches.slice(0, 10)) {
    const titleMatch = itemXml.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const title = titleMatch ? titleMatch[1].trim() : "（無題）";

    const pubDateMatch = itemXml.match(/<pubDate>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/pubDate>/);
    const pubDateStr = pubDateMatch ? pubDateMatch[1].trim() : "";
    const pubDate = pubDateStr ? new Date(pubDateStr) : null;

    const descMatch = itemXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
    let desc = descMatch ? descMatch[1] : "";
    desc = desc.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

    items.push({ title, pubDateStr, pubDate, desc: desc.slice(0, 200) });
  }

  // ② 投稿頻度（平均間隔）の計算
  const validDates = items.map(it => it.pubDate).filter(d => d && !isNaN(d.getTime()));
  let avgHours = 999;
  if (validDates.length >= 2) {
    let diffTotalHours = 0;
    for (let i = 0; i < validDates.length - 1; i++) {
      diffTotalHours += Math.abs(validDates[i].getTime() - validDates[i + 1].getTime()) / (1000 * 60 * 60);
    }
    avgHours = diffTotalHours / (validDates.length - 1);
  }

  // ③ タイトルパターンの統計
  const titles = items.map(it => it.title);
  let questionCount = 0;
  for (const t of titles) {
    if (/[？\?]|(?:ませんか|でしょうか|いけない|いい)$/.test(t)) {
      questionCount++;
    }
  }

  // 頻出キーワード検出 (2文字以上の日本語)
  const wordMap = {};
  for (const t of titles) {
    const words = t.match(/[\u4e00-\u9faf\u30a0-\u30ff]{2,}/g) || [];
    const uniqueInTitle = new Set(words);
    for (const w of uniqueInTitle) {
      wordMap[w] = (wordMap[w] || 0) + 1;
    }
  }
  let topWord = null;
  let topWordCount = 0;
  for (const [w, cnt] of Object.entries(wordMap)) {
    if (cnt > topWordCount && cnt >= 3) {
      topWord = w;
      topWordCount = cnt;
    }
  }

  // ④ フォロー・フォロワー比率の抽出
  let followingCount = null;
  let followerCount = null;

  const nextDataMatch = htmlStr.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const creator = data?.props?.pageProps?.creator;
      if (creator) {
        followingCount = creator.followingCount;
        followerCount = creator.followerCount;
      }
    } catch (_) {}
  }

  if (followingCount === null) {
    const ingM = htmlStr.match(/([\d,]+)\s*(?:フォロー|Following)/);
    if (ingM) followingCount = parseInt(ingM[1].replace(/,/g, ""), 10);
    const werM = htmlStr.match(/([\d,]+)\s*(?:フォロワー|Followers)/);
    if (werM) followerCount = parseInt(werM[1].replace(/,/g, ""), 10);
  }

  // ⑤ マガジンセクション【ピンポイント抽出】
  // <a aria-label="マガジン名" href="https://note.com/{owner}/m/{id}"> から
  // マガジン名と所有者（owner）のみを抽出（本文やUI全体の誤爆を100%防止）
  const magazines = [];
  const pattern1 = /<a\b[^>]*\baria-label="([^"]+)"[^>]*\bhref="https?:\/\/note\.com\/([^\/]+)\/m\/([^"]+)"/g;
  const pattern2 = /<a\b[^>]*\bhref="https?:\/\/note\.com\/([^\/]+)\/m\/([^"]+)"[^>]*\baria-label="([^"]+)"/g;

  let mMatch;
  while ((mMatch = pattern1.exec(htmlStr)) !== null) {
    magazines.push({ title: mMatch[1].trim(), owner: mMatch[2].trim() });
  }
  while ((mMatch = pattern2.exec(htmlStr)) !== null) {
    magazines.push({ title: mMatch[3].trim(), owner: mMatch[1].trim() });
  }

  // ⑤-2 互助会・共同運営マガジンの検知（汎用＆構造化判定）
  // 固有名詞や無理な複合語のリストは廃止し、
  // 1. 本人以外のマガジンに参加しているか (owner !== creatorId)
  // 2. マガジン名に運用意図（共同・互助・相互・フォロバ）が含まれるか
  // の2点のみでシンプルかつ確実に判定
  const detectedMutualMags = [];

  for (const mag of magazines) {
    const isOtherOwner = mag.owner.toLowerCase() !== creatorId.toLowerCase();
    const hasMutualWord = /共同|互助|相互|フォロバ/.test(mag.title);

    if (isOtherOwner || hasMutualWord) {
      detectedMutualMags.push(mag.title);
    }
  }

  // ⑥ スコアリング（点数加算）
  let score = 0;
  const indicators = [];

  // 頻度判定
  if (avgHours <= 16) {
    score += 35;
    indicators.push(`⏱️ **超高頻度・連投ペース**: 平均投稿間隔が約 **${avgHours.toFixed(1)} 時間**（1日に複数本の機械的投稿）`);
  } else if (avgHours <= 28) {
    score += 15;
    indicators.push(`⏱️ **高頻度投稿**: 平均投稿間隔が約 **${avgHours.toFixed(1)} 時間**（毎日欠かさず更新）`);
  } else {
    indicators.push(`⏱️ **自然な更新ペース**: 平均投稿間隔が約 **${avgHours >= 100 ? '数日以上' : avgHours.toFixed(1) + ' 時間'}**`);
  }

  // 相互フォロー判定
  if (followingCount !== null && followerCount !== null) {
    const minF = Math.min(followingCount, followerCount);
    const maxF = Math.max(followingCount, followerCount);
    const ratio = maxF > 0 ? minF / maxF : 0;

    if (followingCount >= 500 && followerCount >= 500 && ratio >= 0.85) {
      score += 35;
      indicators.push(`👥 **相互フォロー運用**: フォロー ${followingCount.toLocaleString()} / フォロワー ${followerCount.toLocaleString()}（比率 **${(ratio * 100).toFixed(0)}%** の数集め運用）`);
    } else {
      indicators.push(`👥 **自然なフォロー状況**: フォロー ${followingCount.toLocaleString()} / フォロワー ${followerCount.toLocaleString()}`);
    }
  }

  // 互助会マガジン判定（マガジンセクションから直接検出された場合のみ）
  if (detectedMutualMags.length >= 1) {
    score += 30;
    indicators.push(`📢 **互助会・共同マガジン参加**: 相互スキ・閲覧数稼ぎ系マガジンへの参加を検知（${detectedMutualMags.slice(0, 3).join(" / ")}）`);
  } else if (magazines.length > 0) {
    indicators.push(`📚 **マガジン状況**: 個人作成マガジン ${magazines.length}件（互助会系マガジンなし）`);
  }

  // タイトル偏り判定
  if (topWord && topWordCount >= Math.ceil(titles.length * 0.5)) {
    score += 15;
    indicators.push(`🏷️ **タイトルの固定テンプレ化**: 直近${titles.length}本中 **${topWordCount}本** に特定キーワード「**${topWord}**」が連続出現`);
  }
  if (titles.length >= 4 && questionCount >= Math.ceil(titles.length * 0.4)) {
    score += 15;
    indicators.push(`❓ **定型共感・問いかけ構文**: 直近${titles.length}本中 **${questionCount}本** が疑問形や共感煽り構文`);
  }

  // 総合カラーとタイトルの確定 (50点以上で赤、25点以上で黄、24点以下で緑)
  let color = "green";
  let titleText = "💎 個人・手書き・信頼性高";
  let authorType = "個人実践者・独自ノウハウ";

  if (score >= 50) {
    color = "red";
    titleText = "⚠️ 警告・AI量産 / 互助会運用アカウント";
    authorType = "AI量産・SNSマーケティング運用アカウント";
  } else if (score >= 25) {
    color = "yellow";
    titleText = "👤 運用型・標準的日常ブログ（一般論中心）";
    authorType = "定期更新・一般ブロガー";
  }

  return {
    creatorId,
    color,
    titleText,
    authorType,
    score,
    indicators,
    latestItem: items[0] || null,
    totalChecked: items.length
  };
}

// 著者判定結果をMarkdownに整形
function formatAuthorResult(analysis) {
  const { color, titleText, authorType, score, indicators } = analysis;

  const pointsList = indicators.map(ind => `- ${ind}`).join("\n");
  
  let markdownBody = `## 📊 客観的データ分析結果 (確実度: 高)
- **判定タイプ**: **${authorType}** (リスクスコア: ${score}点)
${pointsList}
`;

  const rawText = `【判定色】: ${color === "red" ? "赤" : color === "yellow" ? "黄" : "緑"}\n${markdownBody}`;

  return {
    color,
    titleText,
    bodyText: markdownBody,
    rawText
  };
}

// プロンプト取得ヘルパー (記事用)
async function getActivePrompt() {
  const result = await chrome.storage.local.get(["customPrompt"]);
  if (result.customPrompt && result.customPrompt.userTemplate) {
    return result.customPrompt;
  }
  return DEFAULT_PROMPT;
}

// --- Built-in AI 呼び出し (既存完全維持) ---
async function callBuiltInAI(articleText, promptConfig) {
  const aiObj = globalThis.ai?.languageModel || globalThis.LanguageModel;
  
  if (!aiObj) {
    throw new Error("Chrome内蔵AI APIが見つかりません。chrome://flags で #prompt-api が Enabled になっているか確認してください。");
  }

  const availability = await aiObj.capabilities ? (await aiObj.capabilities()).available : await aiObj.availability({
    expectedInputs: [{ type: "text", languages: ["ja"] }],
    expectedOutputs: [{ type: "text", languages: ["ja"] }]
  });

  if (availability === "no" || availability === "unavailable") {
    throw new Error("端末またはブラウザでGemini Nanoがサポートされていません。");
  }

  const session = await aiObj.create({
    initialPrompts: [{ role: "system", content: promptConfig.system }]
  });

  try {
    const finalPrompt = promptConfig.userTemplate.replace("{{articleData}}", articleText);
    const result = await session.prompt(finalPrompt);
    return result.trim();
  } finally {
    if (session.destroy) session.destroy();
  }
}

// --- パース処理 (既存完全維持) ---
function parseAIOutput(rawText) {
  let color = "unknown";
  let titleText = "📝 標準的な体験・考察";
  let bodyText = "";

  const lines = rawText.split('\n');
  const bodyLines = [];

  for (const line of lines) {
    const colorMatch = line.match(/判定色.*?([緑黄赤])/);
    if (colorMatch) {
      const colorChar = colorMatch[1];
      if (colorChar === "緑") {
        color = "green";
        titleText = "💎 安全・独自性・一次情報あり";
      } else if (colorChar === "黄") {
        color = "yellow";
        titleText = "📝 標準的・中立・一般論";
      } else if (colorChar === "赤") {
        color = "red";
        titleText = "⚠️ 警告・商材誘導・抽象論";
      }
      continue;
    }
    bodyLines.push(line);
  }

  bodyText = bodyLines.join('\n').trim();
  if (!bodyText) {
    bodyText = "（分析結果の本文を取得できませんでした）";
  }

  return { color, titleText, bodyText, rawText };
}
