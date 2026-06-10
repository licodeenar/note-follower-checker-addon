const input = document.getElementById("urlname-input");
const manifest = chrome.runtime.getManifest();
const versionEl = document.getElementById("version");
versionEl.innerHTML = `<a href="${manifest.homepage_url}" target="_blank" rel="noopener noreferrer">${manifest.name} v${manifest.version} について</a>`;
const saveBtn = document.getElementById("save-btn");
const savedMsg = document.getElementById("saved-msg");
const resetBtn = document.getElementById("reset-btn");
const resetMsg = document.getElementById("reset-msg");

chrome.storage.local.get("urlname", ({ urlname }) => {
  if (urlname) input.value = urlname;
});

// フルURL（https://note.com/xxx）や @付き入力から urlname を抽出する
function normalizeUrlname(raw) {
  let val = raw.trim();
  const m = val.match(/note\.com\/([^/?#\s]+)/);
  if (m) val = m[1];
  return val.replace(/^@/, "");
}

saveBtn.addEventListener("click", async () => {
  const val = normalizeUrlname(input.value);
  if (!val) return;
  input.value = val;
  const { urlname: prev } = await chrome.storage.local.get("urlname");
  if (prev && prev !== val) {
    await chrome.storage.local.remove([
      "followers", "userKey", "lastChecked", "lastResult", "progress", "checkStartedAt",
    ]);
  } else {
    await chrome.storage.local.remove("lastResult");
  }
  await chrome.storage.local.set({ urlname: val });
  savedMsg.style.display = "block";
  setTimeout(() => { savedMsg.style.display = "none"; }, 2000);
});

resetBtn.addEventListener("click", async () => {
  if (!confirm("フォロワースナップショットを削除しますか？")) return;
  await chrome.storage.local.remove([
    "followers", "userKey", "lastChecked", "lastResult", "progress", "checkStartedAt",
  ]);
  resetMsg.style.display = "block";
  setTimeout(() => { resetMsg.style.display = "none"; }, 2000);
});
