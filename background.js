const API_BASE = "https://note.com/api";
const DELAY_MS = 700;
const PER_PAGE = 20;
const MAX_FOLLOWERS = 1000;
let isChecking = false;


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchUserKey(urlname) {
  const res = await fetch(`${API_BASE}/v2/creators/${urlname}`);
  if (!res.ok) throw new Error(`ユーザー情報取得失敗: ${res.status}`);
  const json = await res.json();
  return { userKey: json.data.key, followerCount: json.data.followerCount ?? null };
}

async function fetchAllFollowers(userKey, followerCount) {
  const followers = [];
  let page = 1;

  while (true) {
    const url = `${API_BASE}/v3/users/${userKey}/followers?page=${page}&per=${PER_PAGE}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`フォロワー取得失敗: page=${page} status=${res.status}`);
    const json = await res.json();
    const follows = json.data?.follows ?? [];
    const is_last_page = json.data?.is_last_page;

    for (const f of follows) {
      followers.push({
        id: f.id,
        name: f.name,
        urlname: f.urlname,
        icon: f.user_profile_image_path || null,
      });
    }

    await chrome.storage.local.set({ progress: followers.length });

    // 終了条件: 最終ページ / 空ページ / 上限到達（API のページ上限による無限ループ防止）
    if (is_last_page || follows.length === 0 || followers.length >= MAX_FOLLOWERS) break;
    page++;
    await sleep(DELAY_MS);
  }

  const incomplete = followers.length < followerCount;
  return { followers, incomplete, fetched: followers.length, expected: followerCount };
}

function calcDiff(prev, curr, incomplete) {
  const prevMap = new Map(prev.map((f) => [f.id, f]));
  const currMap = new Map(curr.map((f) => [f.id, f]));

  let added = curr.filter((f) => !prevMap.has(f.id));
  let removed = prev.filter((f) => !currMap.has(f.id));

  // incomplete（1000件上限で全件取得できていない）時の境界誤検知対策。
  // フォロワーは新しい順に取得されるため、取得範囲の末尾（最も古い側）で
  // ユーザが出入りし、新規・外しの両方に誤検知が生じる。位置で見分ける。
  if (incomplete) {
    // 新規: 本当の新規は必ず curr の先頭に固まる（最新だから）。先頭から
    // 「前回にいない」ユーザを集め、初めて前回にもいるユーザに当たったら打ち切る。
    // それ以降の未知ユーザは、外しで空いた末尾に浮上した旧フォロワー（誤検知）。
    const genuineAdded = [];
    for (const f of curr) {
      if (prevMap.has(f.id)) break;
      genuineAdded.push(f);
    }
    added = genuineAdded;

    // 外し: 末尾（最も古い側）から「今回にいない」ユーザは、新規流入で取得範囲外へ
    // 押し出された可能性があるため除外する。初めて今回にも残っているユーザに
    // 当たったら打ち切る。それより上の不在者は本当の外し。
    const pushedOut = new Set();
    for (let i = prev.length - 1; i >= 0; i--) {
      if (currMap.has(prev[i].id)) break;
      pushedOut.add(prev[i].id);
    }
    removed = removed.filter((f) => !pushedOut.has(f.id));
  }

  return { added, removed };
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "CHECK_FOLLOWERS") {
    if (isChecking) return;
    isChecking = true;
    (async () => {
      try {
        // checking を先に true にして、エラー時も必ず true→false の遷移を発火させる
        // （popup はこの遷移を見てボタンを復帰させるため）
        await chrome.storage.local.set({ checking: true, progress: 0, checkStartedAt: Date.now() });

        const { urlname } = await chrome.storage.local.get("urlname");
        if (!urlname) {
          await chrome.storage.local.set({
            checking: false,
            progress: 0,
            lastResult: { error: "note IDが未設定です。設定画面で入力してください。" },
          });
          return;
        }

        const { userKey, followerCount } = await fetchUserKey(urlname);
        await chrome.storage.local.set({ userKey });

        const { followers: newFollowers, incomplete, fetched, expected } =
          await fetchAllFollowers(userKey, followerCount);

        const { followers: prevFollowers } = await chrome.storage.local.get("followers");
        const now = new Date().toISOString();

        if (!prevFollowers) {
          await chrome.storage.local.set({ followers: newFollowers, lastChecked: now });
          await chrome.storage.local.set({
            checking: false,
            progress: 0,
            lastResult: { isBaseline: false, diff: { added: [], removed: [] }, total: fetched, incomplete, expected },
          });
          return;
        }

        const diff = calcDiff(prevFollowers, newFollowers, incomplete);
        await chrome.storage.local.set({ followers: newFollowers, lastChecked: now });
        await chrome.storage.local.set({
          checking: false,
          progress: 0,
          lastResult: { isBaseline: false, diff, total: fetched, incomplete, expected },
        });
      } catch (err) {
        await chrome.storage.local.set({
          checking: false,
          progress: 0,
          lastResult: { error: err.message },
        });
      } finally {
        isChecking = false;
        chrome.action.setBadgeText({ text: " " });
        chrome.action.setBadgeBackgroundColor({ color: "#E0245E" });
      }
    })();
    // fire-and-forget: return true 不要
  }
});
