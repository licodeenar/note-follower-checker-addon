let currentDiff = null;
let currentTab = "all";
let cooldownTimer = null;
let isCooldown = false;

const COOLDOWN_MS = 10 * 60 * 1000;
// service worker が取得途中で停止すると checking:true が残るため、
// この時間を超えた checking はスタックとみなしてリセットする
// （最大取得時間は 50ページ × 0.7s 待機 + 通信時間 ≒ 1分強。余裕を見て5分）
const STALE_CHECK_MS = 5 * 60 * 1000;

const checkBtn = document.getElementById("check-btn");
const statusEl = document.getElementById("status");
const lastCheckedEl = document.getElementById("last-checked");
const summaryEl = document.getElementById("summary");
const tabsEl = document.getElementById("tabs");
const diffListEl = document.getElementById("diff-list");
const errorMsg = document.getElementById("error-msg");
const warnMsg = document.getElementById("warn-msg");
const cntAdded = document.getElementById("cnt-added");
const cntRemoved = document.getElementById("cnt-removed");
const cntTotal = document.getElementById("cnt-total");

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function avatarEl(f) {
  if (f.icon) {
    return `<img src="${escapeHtml(f.icon)}" class="avatar" alt="">`;
  }
  const initial = [...(f.name || f.urlname || "?")][0] || "?";
  const hue = [...(f.urlname || "")].reduce((n, c) => n + c.charCodeAt(0), 0) % 360;
  return `<div class="avatar avatar-initial" style="background:hsl(${hue},55%,60%)">${escapeHtml(initial)}</div>`;
}

function userLink(f) {
  const href = `https://note.com/${encodeURIComponent(f.urlname || "")}`;
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(f.name || f.urlname)}</a>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyCooldown(lastChecked) {
  clearTimeout(cooldownTimer);
  if (!lastChecked) return;

  const elapsed = Date.now() - new Date(lastChecked).getTime();
  const remaining = COOLDOWN_MS - elapsed;

  if (remaining > 0) {
    isCooldown = true;
    checkBtn.classList.add("cooldown");
    cooldownTimer = setTimeout(() => {
      isCooldown = false;
      checkBtn.classList.remove("cooldown");
    }, remaining);
  } else {
    isCooldown = false;
    checkBtn.classList.remove("cooldown");
  }
}

function renderDiffList(tab) {
  if (!currentDiff) return;

  const { added, removed } = currentDiff;
  const badgeMap = {
    added:   { cls: "badge-added",   label: "増" },
    removed: { cls: "badge-removed", label: "減" },
  };

  let entries;
  if (tab === "all") {
    entries = [
      ...added.map((f) => ({ f, key: "added" })),
      ...removed.map((f) => ({ f, key: "removed" })),
    ];
  } else {
    const items = { added, removed }[tab] ?? [];
    entries = items.map((f) => ({ f, key: tab }));
  }

  if (entries.length === 0) {
    diffListEl.innerHTML = `<div class="empty-note">該当なし</div>`;
    return;
  }

  diffListEl.innerHTML = entries.map(({ f, key }) => {
    const badge = badgeMap[key];
    return `
      <div class="diff-item">
        ${avatarEl(f)}
        <span class="badge ${badge.cls}">${badge.label}</span>
        ${userLink(f)}
      </div>
    `;
  }).join("");
}

function hideResults() {
  summaryEl.style.display = "none";
  tabsEl.style.display = "none";
  diffListEl.style.display = "none";
  errorMsg.style.display = "none";
  warnMsg.style.display = "none";
}

function showResult(result) {
  hideResults();

  if (result.error) {
    errorMsg.textContent = result.error;
    errorMsg.style.display = "block";
    return;
  }

  if (result.incomplete) {
    const expectedText = result.expected != null ? `（実際は ${result.expected} 件）` : "";
    warnMsg.textContent = `⚠️ API制限により ${result.total} 件のみ取得${expectedText}。差分は参考値です。`;
    warnMsg.style.display = "block";
  }

  currentDiff = result.diff;
  cntAdded.textContent = result.diff.added.length;
  cntRemoved.textContent = result.diff.removed.length;
  cntTotal.textContent = result.total;

  summaryEl.style.display = "flex";
  tabsEl.style.display = "block";
  diffListEl.style.display = "block";
  renderDiffList(currentTab);
}

async function loadLastChecked() {
  const { lastChecked } = await chrome.storage.local.get("lastChecked");
  if (lastChecked) {
    lastCheckedEl.textContent = `前回: ${formatDate(lastChecked)}`;
  }
  return lastChecked;
}

// popup 起動時に現在の state を復元
async function restoreState() {
  chrome.action.setBadgeText({ text: "" });
  let { checking, progress, lastResult, checkStartedAt } = await chrome.storage.local.get([
    "checking", "progress", "lastResult", "checkStartedAt",
  ]);

  const lastChecked = await loadLastChecked();

  // service worker 停止などで checking が残ったままになっていたら復旧する
  if (checking && (!checkStartedAt || Date.now() - checkStartedAt > STALE_CHECK_MS)) {
    lastResult = { error: "前回の取得が中断されました。もう一度お試しください。" };
    await chrome.storage.local.set({ checking: false, progress: 0, lastResult });
    checking = false;
  }

  if (checking) {
    checkBtn.disabled = true;
    statusEl.textContent = `取得中... ${progress ?? 0} 件`;
    return;
  }

  applyCooldown(lastChecked);

  if (lastResult) {
    showResult(lastResult);
  }
}

// storage の変化を監視（popup が開いている間）
chrome.storage.onChanged.addListener((changes) => {
  const checking = changes.checking?.newValue;

  if (checking === true) {
    clearTimeout(cooldownTimer);
    isCooldown = false;
    checkBtn.classList.remove("cooldown");
    checkBtn.disabled = true;
    statusEl.textContent = `取得中... ${changes.progress?.newValue ?? 0} 件`;
  } else if (checking === false) {
    checkBtn.disabled = false;
    statusEl.textContent = "";
  }

  // 進捗更新は取得中のみ。完了時（checking が false に遷移）の progress 変化では上書きしない
  if ("progress" in changes && changes.progress.newValue !== undefined && checking !== false) {
    checkBtn.disabled = true;
    statusEl.textContent = `取得中... ${changes.progress.newValue} 件`;
  }

  if ("lastChecked" in changes) {
    if (changes.lastChecked.newValue) {
      loadLastChecked();
      applyCooldown(changes.lastChecked.newValue);
    } else {
      // リセットで削除された
      lastCheckedEl.textContent = "";
      clearTimeout(cooldownTimer);
      isCooldown = false;
      checkBtn.classList.remove("cooldown");
    }
  }

  if ("lastResult" in changes) {
    if (changes.lastResult.newValue) {
      showResult(changes.lastResult.newValue);
    } else {
      // リセットで削除された
      currentDiff = null;
      hideResults();
    }
  }
});

checkBtn.addEventListener("click", () => {
  if (isCooldown) {
    statusEl.textContent = "次回チェックまでしばらく時間をあけてください。";
    return;
  }
  clearTimeout(cooldownTimer);
  checkBtn.disabled = true;
  statusEl.textContent = "取得中...";
  chrome.runtime.sendMessage({ type: "CHECK_FOLLOWERS" });
});

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentTab = btn.dataset.tab;
    renderDiffList(currentTab);
  });
});

document.getElementById("settings-link").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

restoreState();
