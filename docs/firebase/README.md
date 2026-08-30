# firebase — Security Rules と Emulator 設定

**Phase 2 で実装します。Phase 1 時点では空です。**

ここに置く予定のもの:

```
firebase/
├── firestore.rules          Security Rules（設計書 §7.2）
├── firestore.indexes.json   複合インデックス
└── firebase.json            Emulator 設定
```

## 大前提

このアプリは Cloud Functions を持たないため、**Security Rules がセキュリティのほぼ全て**です。
Rules は「実装物」ではなく「テスト対象」として扱い、
`@firebase/rules-unit-testing` + Emulator で全分岐を自動テストします（設計書 §16.7）。

特に以下は必ず緑にします。

- 契約者A のトークンで `clients/B/**` → 拒否
- 契約者A が自分の `users/{uid}` を書き換えて管理者になる → 拒否
- 契約者A が自分の `targets`（目標値）を書き換える → 拒否
- 編集ウィンドウ（既定7日）より古い日付の書き込み → 拒否
- 確定済み（finalized）の日への契約者からの書き込み → 拒否
