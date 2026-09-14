# 技術選定・制限

調査・実装日: 2026-09-14。実際に解決されたバージョンは `package-lock.json` を参照してください。

## 採用

- **Cloudflare Workers + 静的assets**: UIとHTTP／WebSocketを同一originで配信し、別WebサーバーやCORS構成を省く。[公式assets binding](https://developers.cloudflare.com/workers/static-assets/binding/)
- **PartyServer 0.5 / y-partyserver 2.2 / Yjs 13.6**: Cloudflare管理リポジトリのDO向けYjs実装。接続管理・Yjs同期・awareness・保存フックを既存実装へ任せる。[Cloudflare PartyKit](https://github.com/cloudflare/partykit)、[YServerのAPI](https://github.com/cloudflare/partykit/blob/main/packages/y-partyserver/README.md)
- **Tiptap 3.31 + StarterKit + Collaboration + Markdown**: UI、ProseMirrorスキーマ、Yjs変換、Markdownパーサーを共有できる。React等の追加UI層は不要だったためvanilla TypeScriptとした。[Markdown API](https://tiptap.dev/docs/editor/markdown/api/markdown-manager)、[Collaboration](https://tiptap.dev/docs/editor/extensions/functionality/collaboration)
- **npm / Vite / Wrangler / Vitest / Playwright / ESLint / Prettier**: lockfile、型検査、ローカルworkerd、ブラウザ検証を単一リポジトリで再現する。
- **Octokit App認証 + GitHub REST**: App JWTと期限付きinstallation tokenをライブラリで取得し、tree／commit／ref／PRの小さなアダプターで公開する。[Octokit](https://github.com/octokit/auth-app.js)、[Git references REST](https://docs.github.com/en/rest/git/refs)
- **Cloudflare Access + jose**: 公開Workerを誰でもPR作成可能にしないための外部認証境界。ユーザーDBや独自ログインフローは追加しない。

## 比較した選択肢

Cloudflare PartyKitリポジトリにはPartyServer、y-partyserver、ルーティング等の用途別パッケージがある。直接Durable ObjectにYjs wire protocolを書く方法と比べ、YServerを継承する方が小さく、再接続・同期の独自実装を避けられる。

汎用Yjsサーバーを別プロセスで運用する構成より、DO向けの既存統合を選んだ。Tiptapの商用クラウド共同編集サービスはこのPoCに不要。MarkdownManagerがDOMなしで使えるため、初期化と公開の両方をWorkerで行える。旧third-party Markdown拡張を重ねず、同じTiptapバージョンの公式拡張を使用した。

## 保存と障害境界

`Draft.onLoad` はSQLテーブルを作り、snapshotがあれば復元、なければGitHubから初期化する。SQLの単一行に元リビジョンのJSONとYjsバイナリを保存するため、片方だけ更新された状態は作らない。KVの1値サイズ制限を避けるため、ドキュメント本体はSQL BLOBを使う。公開結果は小さいのでDO KVに置く。

Yjs更新イベントの保存処理は、ライブラリが更新を他クライアントへ送るハンドラーより先に登録する。DOのSQLite書き込みと出力ゲートを利用する。一般的なWebSocket到達保証とは別であり、クライアントに未送信のデータを永続化するものではない。画面のConnectedは接続／同期の状態であり、ユーザーの各打鍵に対する独立した保存受領証ではない。

全クライアントを閉じ、Wranglerのプロセスを停止し、同じ永続化ディレクトリから起動し直すテストで、ブラウザからの再投入に頼らない復元を確認する。

## PoCとして残した制限

- 1リポジトリ、既存の `.md` ファイルのみ。作成・移動・削除や巨大リポジトリのページ分割は対象外。GitHub recursive treeがtruncatedならエラーにする。
- GitHub入力／公開出力は512 KBまで。編集中のCRDTのサイズ制限・長期履歴圧縮・悪意ある巨大WebSocketメッセージへの防御は未実装。信頼された小人数による小さな開発文書の実験向けであり、負荷試験はしていない。
- 完全スナップショットを更新ごとに書く単純な方式。大規模利用の書き込み量／性能の最適化はしていない。
- y-partyserverの通常のWebSocket運用。hibernationの最適化は選択しておらず、実アカウントでの稼働費用や長時間アイドル挙動は未測定。
- 切断中に開いたままのタブは再接続できる。オフラインでタブを閉じる場合の未送信変更の保持は未対応。
- presenceのwire処理はライブラリに任せるが、カーソルや参加者一覧のUIはない。
- Markdownのrawソース編集・任意拡張のlossless round-tripは対象外。front matterの編集UIは作らず原文を保存する。
- ドラフトの自動終了、PRの継続更新、マージ後のbase更新はない。同じドラフトの異なるスナップショットは別PR。同じ内容は以前のPR（closed/merged含む）を返す。
- HTTPタイムアウト後もリトライでブランチ／PRを再利用できるが、不要になった孤立Gitオブジェクトやブランチの掃除はしない。
- GitHub Appがコミット／PRの主体となる。ユーザーごとのGit authorship、文書ACL、WebSocket接続中のAccess失効の即時反映は対象外。
- Viteのクライアントはminified約635 KB（gzip約201 KB）。エディター一式を初回ロードするPoCとして許容。Tiptap配布コード内のJSXコメントにWranglerが警告するが、型検査・ビルド・ローカル実行に影響しない。

## ローカルで模擬した部分

実際のDO、SQLite、WebSocket、Chromium、Tiptapは動かしている。GitHubのネットワーク境界はリクエスト／レスポンスfakeで検証し、App権限と実APIの応答は外部E2Eに残す。Cloudflare Access JWTはローカル生成RSA鍵で署名・audience・期限の検証をテストしたが、実IdPのログインは未実施。

GitHub fakeは新しいheadと古いdraft baseを区別し、treeとcommitの親が古いbaseになること、PR作成失敗後の再実行がブランチを重複作成しないことを検査する。fixtureの公開済みソースは固定で、PR作成結果だけを模擬する。fixtureでGitHubのマージや履歴全体を再現するわけではない。
