# Chrome拡張機能：noteフォロワー差分チェッカー

## 概要

note.com のフォロワーリストを手動取得し、前回との差分（増えた人・減った人・退会者）をChrome拡張機能のポップアップで表示するツール。

---

## 使用するAPI

### ユーザー情報取得
```
GET https://note.com/api/v2/creators/{urlname}
```
- 認証不要（公開API）
- レスポンス例（主要フィールド）：
  ```json
  {
    "data": {
      "id": 1000000,
      "key": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "nickname": "サンプルユーザー",
      "urlname": "sample_user",
      "followerCount": 1086
    }
  }
  ```
- `key` フィールドがフォロワーリストAPIで使うuser_key

### フォロワーリスト取得
```
GET https://note.com/api/v3/users/{user_key}/followers?page={page}&per={per}
```
- 認証不要（公開API）
- `per` の実効上限は **20**（それ以上の値は機能しない）
- **API制限**: ページ上限により最大1000件までしか取得できない（page上限 × per=20）
- レスポンス例：
  ```json
  {
    "data": {
      "follows": [
        {
          "id": 2000000,
          "key": "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy",
          "name": "サンプルフォロワー",
          "urlname": "sample_follower",
          "withdrawal": false,
          "user_profile_image_path": "https://assets.st-note.com/production/uploads/images/..."
        }
      ],
      "total_count": 1086,
      "is_last_page": false
    }
  }
  ```

### 重要フィールド
| フィールド | 説明 |
|---|---|
| `id` | ユーザーの一意ID。差分比較のキーとして使う |
| `name` | 表示名 |
| `urlname` | noteのURL用ユーザー名（`https://note.com/{urlname}`） |
| `withdrawal` | 退会フラグ。`true` なら退会済みユーザー |
| `user_profile_image_path` | プロフィールアイコンURL |
| `is_last_page` | `true` になったらページネーション終了 |

---

## 機能要件

### 基本フロー
1. ユーザーが自分のnote `urlname` を設定画面で入力
2. ポップアップの「チェック」ボタンを押したときだけAPIを呼び出す（自動実行なし）
3. 全フォロワーをページネーションで全件取得（上限1000件）
4. 取得したリストを `chrome.storage.local` にスナップショットとして保存
5. 前回保存済みのスナップショットと差分比較して結果を表示
6. 初回チェック時（スナップショットなし）は「ベースライン取得済み」と表示するだけで差分なし

### 差分の分類
- **新規フォロワー**：今回取得リストにあって前回にないID
- **フォロー外し**：前回リストにあって今回ないID（`withdrawal: false`）
- **退会**：前回リストにあって今回ないID（`withdrawal: true`）

### その他の仕様
- **バックグラウンド処理**：チェック中にポップアップを閉じても処理は継続。再度開いたとき結果を復元して表示する
- **重複チェック防止**：処理中は後続のチェックリクエストを無視する（`isChecking` フラグ）
- **10分クールダウン**：前回チェックから10分未満の場合はボタンを押せない。強引に押すとメッセージを表示
- **API制限警告**：取得件数が実際のフォロワー数より少ない場合、差分は参考値として警告を表示

### ストレージ設計
```js
chrome.storage.local.set({
  urlname: "sample_user",         // 設定したユーザー名
  userKey: "xxxxxxxx...",         // APIで取得したkey
  lastChecked: "2025-06-07T...", // 最終チェック日時
  followers: [                    // スナップショット
    {
      id: 2000000,
      name: "サンプルフォロワー",
      urlname: "sample_follower",
      withdrawal: false,
      icon: "https://assets.st-note.com/..."  // user_profile_image_path の値
    },
    ...
  ],
  checking: false,                // チェック処理中フラグ
  progress: 1000,                 // 取得済み件数（進捗表示用）
  lastResult: {                   // 直近チェック結果
    isBaseline: false,
    diff: { added: [...], unfollowed: [...], withdrawn: [...] },
    total: 1000,
    incomplete: true,             // 取得件数 < 実際のフォロワー数のとき true
    expected: 1086
  }
});
```

---

## ファイル構成

```
note-follower-checker/
├── manifest.json
├── popup.html
├── popup.js
├── options.html       // urlname設定画面・スナップショットリセット
├── options.js
├── background.js      // API取得処理（service worker）
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## manifest.json の主要設定

```json
{
  "manifest_version": 3,
  "name": "note フォロワーチェッカー",
  "version": "1.0",
  "permissions": ["storage"],
  "host_permissions": ["https://note.com/*"],
  "action": {
    "default_popup": "popup.html"
  },
  "options_page": "options.html",
  "background": {
    "service_worker": "background.js"
  }
}
```

---

## UI要件

### ポップアップ（popup.html）
- 前回チェック日時の表示
- 「チェック」ボタン
  - チェック中：disabled + 取得件数の進捗表示
  - クールダウン中（前回から10分未満）：グレーアウト。押すとメッセージ表示
- 取得中はローディング表示（1000件超のため数秒〜数分かかる）
- API制限警告（取得件数 < 実フォロワー数のとき黄色バナー）
- 差分サマリー（新規数・減少数・合計）
- 差分リスト（タブ切り替え）：
  - **すべて**（デフォルト）：新規・フォロー外し・退会を色分けバッジで一覧表示
  - **新規**フォロワー一覧（アイコン + 名前 + noteリンク）
  - **フォロー外し**一覧
  - **退会者**一覧
- 各ユーザーにアイコン表示（`user_profile_image_path` がある場合は実画像、ない場合は頭文字CSS円形アバター）
- 初回チェック時は「ベースライン保存済み。次回チェック時から差分が表示されます」と表示

### 設定画面（options.html）
- urlname 入力フィールド・保存ボタン
- スナップショットリセットボタン（followers / userKey / lastChecked を削除）

---

## 注意事項

- note.com の非公式APIのため、仕様が変更になる可能性あり
- フォロワーリストAPIは最大1000件の制限あり（page上限による）
- サーバー負荷軽減のためリクエスト間隔を700ms設けている
- `per` パラメータは20が実効上限
