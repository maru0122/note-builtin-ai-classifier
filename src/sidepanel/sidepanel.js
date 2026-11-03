import { DEFAULT_PROMPT } from "../background.js";

const systemInput = document.getElementById("system-prompt");
const userInput = document.getElementById("user-prompt");
const btnSave = document.getElementById("btn-save");
const btnReset = document.getElementById("btn-reset");
const btnCopyMeta = document.getElementById("btn-copy-meta");
const metaPromptText = document.getElementById("meta-prompt-text");
const statusMsg = document.getElementById("status-message");

// 初期化
async function loadPrompt() {
  try {
    const data = await chrome.storage.local.get(["customPrompt"]);
    if (data.customPrompt) {
      systemInput.value = data.customPrompt.system || DEFAULT_PROMPT.system;
      userInput.value = data.customPrompt.userTemplate || DEFAULT_PROMPT.userTemplate;
    } else {
      systemInput.value = DEFAULT_PROMPT.system;
      userInput.value = DEFAULT_PROMPT.userTemplate;
    }
  } catch (err) {
    showStatus("設定の読み込みに失敗しました: " + err.message, "error");
  }
}

// 保存
btnSave.addEventListener("click", async () => {
  const system = systemInput.value.trim();
  const userTemplate = userInput.value.trim();

  if (!userTemplate.includes("{{articleData}}")) {
    showStatus("エラー: ユーザープロンプト内に {{articleData}} が含まれていません。", "error");
    return;
  }

  try {
    await chrome.storage.local.set({
      customPrompt: { system, userTemplate }
    });
    showStatus("✅ プロンプト設定を保存しました。", "success");
  } catch (err) {
    showStatus("保存に失敗しました: " + err.message, "error");
  }
});

// リセット
btnReset.addEventListener("click", async () => {
  if (!confirm("プロンプト設定を初期状態に戻しますか？")) return;

  systemInput.value = DEFAULT_PROMPT.system;
  userInput.value = DEFAULT_PROMPT.userTemplate;

  try {
    await chrome.storage.local.remove("customPrompt");
    showStatus("🔄 初期設定に戻しました。", "success");
  } catch (err) {
    showStatus("リセットに失敗しました: " + err.message, "error");
  }
});

// メタプロンプトのコピー
btnCopyMeta.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(metaPromptText.value);
    const originalText = btnCopyMeta.innerText;
    btnCopyMeta.innerText = "✅ コピーしました！";
    btnCopyMeta.style.background = "#dcfce7";
    btnCopyMeta.style.color = "#166534";
    
    setTimeout(() => {
      btnCopyMeta.innerText = originalText;
      btnCopyMeta.style.background = "";
      btnCopyMeta.style.color = "";
    }, 2000);
  } catch (err) {
    showStatus("コピーに失敗しました", "error");
  }
});

function showStatus(text, type) {
  statusMsg.textContent = text;
  statusMsg.className = `status-message ${type}`;
  setTimeout(() => {
    statusMsg.style.display = "none";
  }, 4000);
}

loadPrompt();
