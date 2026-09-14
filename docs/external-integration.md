# 外部連携の最終確認

ローカルfixtureの代わりにGitHub Appへ接続し、実Cloudflareアカウントへデプロイするための手順です。この作業中、実アカウントへのログイン・デプロイ・GitHub書き込みは行っていません。

## 1. ローカル確認とCloudflare認証

```bash
npm ci
npm run setup:browser
npm run verify
npx wrangler login
npx wrangler whoami
```

対象アカウントでWorkersとSQLite Durable Objectsが利用できることを確認します。複数アカウントがある場合は `wrangler.jsonc` に対象の `account_id` を設定してください。

## 2. GitHub App

GitHubのSettings → Developer settings → GitHub AppsからAppを作成します。

- Repository permissions: **Contents: Read and write**、**Pull requests: Read and write**。Metadataは自動的にreadになります。
- Webhookは無効で構いません。OAuth callbackやユーザー認可フローも不要です。
- 対象リポジトリだけにインストールします。既存のコミットと `.md` ファイルがあるリポジトリを使います。
- App IDと、インストール設定画面URL末尾のInstallation IDを控えます。両者は別の値です。
- 秘密鍵を生成してダウンロードします。

WorkersのWebCryptoに合わせ、秘密鍵をPKCS#8 PEM（`BEGIN PRIVATE KEY`）に変換します。鍵はリポジトリ外に置きます。

```bash
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
  -in /secure/path/github-app.pem -out /secure/path/github-app-pkcs8.pem
```

[GitHub App installation認証](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)と[Octokitの鍵形式](https://github.com/octokit/auth-app.js#standalone-usage)を参照してください。

## 3. production設定と秘密情報

`wrangler.jsonc` の `env.production.vars` を変更します。top-levelはローカルfixture用なので残してください。

| 変数                 | 値                                               |
| -------------------- | ------------------------------------------------ |
| `REPOSITORY_MODE`    | `github`（設定済み）                             |
| `GITHUB_OWNER`       | GitHubの組織またはユーザー名                     |
| `GITHUB_REPO`        | リポジトリ名のみ                                 |
| `GITHUB_BRANCH`      | PRの対象ブランチ。通常 `main`                    |
| `ACCESS_TEAM_DOMAIN` | `your-team.cloudflareaccess.com`。`https://`不要 |
| `ACCESS_AUD`         | 次節で作成するAccessアプリのAUD tag              |

秘密情報は以下で登録します。App ID／Installation IDはプロンプトに入力し、秘密鍵はPEMファイルを標準入力で渡します。

```bash
npx wrangler secret put GITHUB_APP_ID --env production
npx wrangler secret put GITHUB_INSTALLATION_ID --env production
npx wrangler secret put GITHUB_PRIVATE_KEY --env production < /secure/path/github-app-pkcs8.pem
```

Workerがまだ存在しない場合、Wranglerの作成案内に従うか、先に `npm run deploy` で保護された初回Workerを作ります。Access設定／secretsが不足していてもproductionは未認証アクセスを拒否します。

## 4. Cloudflare Access

本PoCは独自ログインを作らず、Cloudflare AccessによってHTTPとWebSocketの接続元を認証します。

1. `npm run deploy` でWorkerのURLを取得します。通常 `https://poc-md-cms-production.<account-subdomain>.workers.dev` です。この時点ではAccess未設定のため401が正常です。
2. Cloudflare側でこの**本番ホスト全体**を保護するAccessアプリを設定します。Workersのworkers.dev Access保護、またはカスタムドメインに対するSelf-hostedアプリを使用します。プレビューURLだけの保護ではありません。
3. テストに使う利用者をAllowポリシーに登録します。メールのワンタイムPINまたは既存IdPを使えます。Bypassポリシーは使いません。
4. Accessのteam domainとアプリのAUD tagを `env.production.vars` に設定し、再デプロイします。

Workerは `Cf-Access-Jwt-Assertion`、またはWebSocket接続時の `CF_Authorization` cookieを検証します。署名・issuer・audience・期限が一致しなければ401です。別のURLでWorkerに到達してもJWT検証を通過する必要があります。

設定の詳細は[Self-hosted Accessアプリ](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)と[JWT検証](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)を参照してください。

## 5. 最終デプロイとE2E

```bash
npm run deploy
npx wrangler tail --env production
```

1. 独立した2ブラウザで本番URLへアクセスし、それぞれAccess認証します。ヘッダーが `GITHUB` と設定リポジトリ名になっていることを確認します。
2. ディレクトリから同じMarkdown文書を開きます。表示された公開コミットSHAを記録します。
3. 両方で編集を開始し、互いの入力が反映されることを確認します。
4. 一方を再読み込みして編集に戻り、ドラフトとbase SHAが残ることを確認します。一時切断からの再接続も確認します。
5. Markdown snapshotでコード・リスト・front matterを確認します。
6. Prepare pull requestを押し、表示されたPRリンクを開きます。
7. `cms/<hash>` ブランチが作られ、コミットの親が記録したbase SHAであり、変更ファイルが対象文書だけであることをGitHubで確認します。
8. 同じ内容で再実行すると同じPRになることを確認します。GitHubでマージするまではPublishedの本文が変わらないことを確認します。
9. 必要なら別のテスト文書で、編集開始後にGitHub側の同じ行を変更してからPRを作り、元baseが維持されて競合がGitHub上に現れることを確認します。異なる行の変更は通常自動マージ可能なので、必ず競合するとは限りません。

この外部E2Eだけが未実施です。追加のアプリ実装や独自マージエンジンは不要です。

## 失敗時の確認

- 401: Accessホスト・Allowポリシー・team domain・AUD・ログイン期限を確認します。
- GitHub 401/403: App IDとInstallation IDの取り違え、秘密鍵形式、インストール権限／対象リポジトリを確認します。
- GitHub 404: owner/repo/branchが正しいか、Appが対象リポジトリにインストール済みか確認します。
- 409: 本文の同期が完了してからスナップショットを確認し再試行します。
- GitHub 422: GitHubの保護ルール、対象ブランチ、差分が存在するかを確認します。PR作成の途中で失敗しても、同じ内容を再試行できます。
- 接続切断: タブを閉じず再接続を待ちます。切断中の未送信データを保持するIndexedDBはPoC範囲外です。
