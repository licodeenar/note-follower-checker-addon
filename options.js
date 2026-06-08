const input = document.getElementById("urlname-input");
const saveBtn = document.getElementById("save-btn");
const savedMsg = document.getElementById("saved-msg");
const resetBtn = document.getElementById("reset-btn");
const resetMsg = document.getElementById("reset-msg");

chrome.storage.local.get("urlname", ({ urlname }) => {
  if (urlname) input.value = urlname;
});

saveBtn.addEventListener("click", async () => {
  const val = input.value.trim();
  if (!val) return;
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
