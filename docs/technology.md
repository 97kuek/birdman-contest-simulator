# 技術選定

2026年11月19日。竜海をスマホとPCのブラウザで操縦し、同じ条件の飛行をリプレイで比較する用途を対象とする。

**現時点では、飛行計算は JavaScript、3D表示は Three.js、操作画面は HTML と CSS、実機ログの再解析は R が適している。** ビルドには Vite を使い、生成した静的ファイルを GitHub Pages で配信する。R の実行環境はプレイヤーにも公開サイトのビルドにも不要である。[プロジェクトの依存関係と実行コマンド](../package.json)・[公開ワークフロー](../.github/workflows/pages.yml)・[Vite の静的配信](https://vite.dev/guide/static-deploy.html#github-pages)

| 対象 | このシミュレーターでの判断 | 見直す条件 |
| --- | --- | --- |
| 飛行計算 | 固定刻みの運動計算と着水判定を ES Modules に置く。同じ JavaScript をブラウザの操縦、比較用の自動計算、Node.js の回帰テストから呼べる。 | 機体設計の入力や保存ログの形式を増やす時は、まず飛行条件と記録の読み書きに型検査を導入する。既存の JavaScript に JSDoc と TypeScript の `checkJs` を適用できる。`.ts` を導入する場合、CI では Vite の変換に加え `tsc --noEmit` を実行する。[TypeScript の checkJs](https://www.typescriptlang.org/tsconfig/checkJs.html)・[Vite の TypeScript 対応](https://vite.dev/guide/features.html#typescript) |
| 3D描画 | 竜海、湖面の反射、地形、カメラは Three.js の描画側が扱う。現行の `WebGLRenderer` は WebGL 2 を使う。最低対応端末を決める際には、この機能と実際の画面描画を確認する。 | 描画時間が長い端末では、まず水面反射、影、描画解像度を個別に変更して測る。レンダラーを替える判断材料は、同じ機体・湖面・カメラでの画質とフレーム時間である。[Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html) |
| 操作画面 | 計器、電光掲示板、操縦ボタンは HTML と CSS で表現できる。`any-pointer: coarse` でタッチ用ボタンを出し、Pointer Events の指ごとの識別子で体重移動とラダーを独立させる。指が離れた時や端末が入力を中断した時に、その指の指令を解除する。 | 機体編集などで複数の画面が同じ編集状態を扱うようになったら、UIフレームワークの導入をその画面で比較する。[W3C Media Queries](https://www.w3.org/TR/mediaqueries-4/#any-input)・[W3C Pointer Events](https://www.w3.org/TR/pointerevents3/#the-pointercancel-event) |
| 実機ログの分析 | 鳥科のCSVからGPS進路を求め、ICS舵角とIMU姿勢を集計・描画する工程は、Rの標準配布に含まれる機能で完結する。元ログから図と数値を再計算できるため、検証用のコードとして残す。 | ブラウザ上で任意のログを解析する機能を作る際は、対象の計算を JavaScript へ移し、同じCSV・時間窓でR版の結果と突き合わせる。[R Project](https://www.r-project.org/about.html) |

## 性能を理由に言語を替える場合

飛行計算は秒間120ステップ、軌跡の記録は秒間20サンプルで、どちらも画面のフレームレートとは別に決まる。スマホで動きが重い場合は、同じ端末・風・操縦入力で離台後10秒間を記録し、飛行計算のCPU時間、3D描画時間、初期の地形読み込みを切り分ける。CPUプロファイルと Three.js の `renderer.info` の描画回数・三角形数を併用できる。[Chrome DevTools の Performance](https://developer.chrome.com/docs/devtools/performance/overview)・[Three.js の描画統計](https://threejs.org/docs/pages/WebGLRenderer.html#info)

物理計算が繰り返しフレーム遅延の主要因となる場合に、計算部分だけを WebAssembly と比べる。変換に伴うデータ受け渡しを含めて同一端末で時間を測り、軌跡・飛距離・接水時刻も既存テストで照合する。今回の選定はコードと実行経路に基づくもので、別言語版との速度差は未計測である。[WebAssembly の設計目標](https://webassembly.org/docs/high-level-goals/)
