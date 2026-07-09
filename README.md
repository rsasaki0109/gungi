# 軍儀 (Gungi) — ブラウザ対戦ゲーム

『HUNTER×HUNTER』に登場する戦略ボードゲーム **軍儀** を、ブラウザだけで遊べる
静的Webアプリとして実装したものです。**サーバー不要・ビルド不要**。GitHub Pages に
そのまま置けば動きます。スマホ／PC 両対応のレスポンシブUI。

- 9×9 盤・**3段積み（ツケ）**・**持ち駒／新（アラタ）打ち**・**寝返り（謀）** に対応
- CPU 対戦 **3段階**（弱 / 中 / 強）。強は Minimax + α-β 反復深化。
- 駒配置フェーズ、王手／詰み判定、行動ログ、待った、棋譜保存／読込（JSON）

> 駒の動きは、gungi.io / gungi.js 系の機械的に定義された 14 種ルールセットに準拠しています
> （原作漫画では全駒の動きが明示されていないため、実装可能な公開ルールセットを採用）。

**▶ 今すぐ遊ぶ： https://rsasaki0109.github.io/gungi/**

## スクリーンショット

<p align="center">
  <img src="https://raw.githubusercontent.com/rsasaki0109/gungi/main/assets/play.png" alt="対局画面 — 駒を選ぶと移動可能マスがハイライト" width="640"><br>
  <sub>対局画面（駒を選ぶと移動可能マス／ツケ／取りをハイライト）</sub>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/rsasaki0109/gungi/main/assets/mobile.png" alt="モバイル表示（1カラム・レスポンシブ）" width="260"><br>
  <sub>スマホ表示（1カラム・レスポンシブ）</sub>
</p>

## 遊び方

1. **配置フェーズ**：画面下の「持ち駒」から駒を選び、自陣（下3段）をクリックして布陣します。
   - 置いた駒をクリックすると持ち駒に戻せます。
   - 「おまかせ配置」で定跡的な布陣を自動生成できます。
   - **帥（大将）** を置いたら「対局開始 ▶」。CPU 側は自動で布陣します。
2. **対局**：自分の駒をクリック → 移動可能マスがハイライト → 行き先をクリックで移動。
   - 相手の駒の上に乗ると**取れます**（取った駒は自分の持ち駒になり、再び「新」で打てます）。
   - 味方の駒に乗ると**ツケ**（塔を高くする＝射程が伸びる）。
   - 持ち駒をクリック → 打てるマスがハイライト → クリックで**新（アラタ）打ち**。
3. **勝敗**：相手の**帥**を取れば勝ち。詰み・手詰まりでも決着します。

### CPU の強さ

| レベル | 探索 | 特徴 |
|--------|------|------|
| 弱 Easy   | ほぼランダム（合法手のみ） | 駒得の一手だけは拾う。初心者向け。 |
| 中 Normal | 2手読み + 静止探索 | 駒損を避け、王を守る堅実な指し回し。 |
| 強 Hard   | 反復深化 Minimax + α-β（深さ5目安）+ 静止探索 | 駒価値・旗（帥）への距離・守備力・王安全度を評価。数手先の戦術を突く。 |

思考中は盤面中央に「CPU 思考中…」を表示します。

## 機能

- New Game（新規）／同じ布陣で再戦（Restart）／待った（Undo）
- CPU レベル変更
- 棋譜保存（JSON ダウンロード）／棋譜読込（JSON）
- 取った駒表示・手番表示・王手表示・対局ログ
- 駒移動／攻撃／勝利のアニメーション

## ディレクトリ構成

責務ごとに分割しています。

```
index.html          … 画面の骨組み
styles.css          … スタイル（レスポンシブ）
src/
  main.js           … 起動・各モジュールの結線
  game/
    constants.js    … ルール定義（駒種・枚数・movesetテーブル・評価値）
    board.js        … 9×9×3 の盤（塔）と持ち駒
    ruleEngine.js   … 着手生成・合法性・王手/詰み・apply/undo
    gameManager.js  … 手番/配置/履歴/ログ/棋譜(JSON)
  ai/
    evaluate.js     … 静的評価関数
    search.js       … Minimax + α-β + 反復深化 + 静止探索
    ai.js           … レベル振り分け（弱/中/強）
  ui/
    renderer.js     … 盤・持ち駒・パネルの描画（状態→DOM）
    controller.js   … 入力・演出・AIターンの制御
    animations.js   … 移動/攻撃/勝利アニメーション
.github/workflows/deploy.yml … GitHub Pages 自動デプロイ
```

主要クラス／モジュール：**Board / Piece(構造体) / RuleEngine / AI / Renderer / GameManager** を分離。

## ローカルで動かす

ES モジュールを使うため、`file://` ではなく HTTP で配信してください。

```bash
# どれでも可
python3 -m http.server 8000
# → http://localhost:8000/ を開く
```

ビルドは不要です。

## テスト（Playwright E2E）

ブラウザ実機（Chromium）で盤面描画・配置・着手・CPU応手・待った・レスポンシブ・
コンソールエラーの有無までを検証します。

```bash
npm install                 # playwright を取得
npx playwright install chromium
npm start &                 # http://127.0.0.1:8123 で配信
npm run test:e2e            # 23項目のE2Eテスト（スクリーンショットは tests/.shots/）
# 公開中サイトに対して実行する場合:
GUNGI_URL="https://<user>.github.io/gungi/" npm run test:e2e
```

## 学習AI（AlphaZero式・β）

CPUレベルに **「学習AI (β)」** を追加しました。方策＋価値のニューラルネット（純JS・依存ゼロ）を
**PUCT MCTS** で用いる、AlphaZero式のエージェントです。ブラウザは `assets/model.json`（int8量子化・
約540KB）を読み込み、依存なしで推論します（**ビルド不要のまま**）。

学習は Node でオフライン実行し、成果物（重み）だけを配置します。

```bash
# 1) ミニマックスを教師にウォームスタート（value=tanh(eval), policy=最善手）
node train/warmstart.mjs [games] [epochs] [arenaGames]   # 例: node train/warmstart.mjs 70 12 6
# 2) 自己対戦で改善（AlphaZeroループ：自己対戦→学習→棋力測定）
node train/selfplay.mjs [iterations] [gamesPerIter] [sims]
# → いずれも assets/model.json を更新
```

構成：`src/ai/nn.js`（MLP・2ヘッド・Adam・量子化保存）／`src/ai/encode.js`（手番視点の正準符号化・
分解方策）／`src/ai/mcts.js`（PUCT・Dirichletノイズ・時間制御）／`train/`（学習スクリプト）。

> β版です。CPUのみの学習のため棋力は発展途上で、計算資源（自己対戦の反復）を増やすほど強くなります。
> ブラウザ側は時間制御MCTSなので端末性能に自動追従します（`model.json` 読込失敗時は Hard にフォールバック）。

## GitHub Pages で公開

1. このリポジトリを GitHub に push。
2. リポジトリの **Settings → Pages → Build and deployment → Source** を
   **GitHub Actions** に設定（同梱の `.github/workflows/deploy.yml` が公開します）。
   - もしくは **Deploy from a branch: `main` / `root`** でも動きます（ビルド不要のため）。
3. `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます。

相対パス（`./styles.css`, `./src/main.js`）で参照しているため、サブディレクトリ配信でもそのまま動作します。

## 設計：将来の拡張

以下を追加しやすい構造にしています。

- **オンライン対戦**：`RuleEngine` の `applyMove`/`generateLegalMoves` と JSON 棋譜を
  そのまま通信層に載せられます（GameManager はネットワーク非依存）。
- **AI 強化**：`evaluate.js` の評価関数と `search.js` の探索は差し替え可能。
  置換で MCTS や学習済み評価に移行できます。
- **棋譜解析・観戦・棋譜共有**：履歴（`GameManager.history`）と JSON シリアライズが
  あるため、リプレイ／解析ビューを別UIとして追加可能。

## ルール準拠についての補足

軍儀は原作で全ルールが明示されていないため、本実装は公開されている機械可読ルールセット
（14駒種・段による射程拡張・砲/筒/弓の跳躍・弓の翼ブロック 等）を採用しています。
細部（例：寝返りの条件、二歩相当の禁止）は遊びやすさを優先した実装上の解釈を含みます。
`src/game/constants.js` の moveset テーブルを編集すれば、駒の動きは一箇所で調整できます。
