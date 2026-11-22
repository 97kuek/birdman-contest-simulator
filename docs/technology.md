# 技術選定

2026年11月19日。竜海とQX-25をスマホとPCのブラウザで操縦し、同じ条件の飛行をリプレイで比較する用途を対象とする。

**現時点では、飛行計算は JavaScript、3D表示は Three.js、操作画面は HTML と CSS、実機ログの再解析は R と Python が適している。** ビルドには Vite を使い、生成した静的ファイルを GitHub Pages で配信する。R の実行環境はプレイヤーにも公開サイトのビルドにも不要である。[プロジェクトの依存関係と実行コマンド](../package.json)・[公開ワークフロー](../.github/workflows/pages.yml)・[Vite の静的配信](https://vite.dev/guide/static-deploy.html#github-pages)

| 対象 | このシミュレーターでの判断 | 見直す条件 |
| --- | --- | --- |
| 飛行計算 | 固定刻みの運動計算と着水判定を ES Modules に置く。同じ JavaScript をブラウザの操縦、比較用の自動計算、Node.js の回帰テストから呼べる。 | 機体設計の入力や保存ログの形式を増やす時は、まず飛行条件と記録の読み書きに型検査を導入する。既存の JavaScript に JSDoc と TypeScript の `checkJs` を適用できる。`.ts` を導入する場合、CI では Vite の変換に加え `tsc --noEmit` を実行する。[TypeScript の checkJs](https://www.typescriptlang.org/tsconfig/checkJs.html)・[Vite の TypeScript 対応](https://vite.dev/guide/features.html#typescript) |
| 3D描画 | 竜海、湖面の反射、地形、カメラは Three.js の描画側が扱う。現行の `WebGLRenderer` は WebGL 2 を使う。最低対応端末を決める際には、この機能と実際の画面描画を確認する。 | 描画時間が長い端末では、まず水面反射、影、描画解像度を個別に変更して測る。レンダラーを替える判断材料は、同じ機体・湖面・カメラでの画質とフレーム時間である。[Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html) |
| 操作画面 | 結果の電光掲示板と操縦ボタンは HTML と CSS、操縦席の計器は3D上の表示で扱う。`any-pointer: coarse` でタッチ用ボタンを出し、Pointer Events の指ごとの識別子で体重移動とラダーを独立させる。指が離れた時や端末が入力を中断した時に、その指の指令を解除する。 | 機体編集などで複数の画面が同じ編集状態を扱うようになったら、UIフレームワークの導入をその画面で比較する。[W3C Media Queries](https://www.w3.org/TR/mediaqueries-4/#any-input)・[W3C Pointer Events](https://www.w3.org/TR/pointerevents3/#the-pointercancel-event) |
| 実機ログの分析 | 鳥科のCSVからGPS進路を求め、ICS舵角とIMU姿勢を集計・描画する工程は、Rの標準配布に含まれる機能で完結する。元ログから図と数値を再計算できるため、検証用のコードとして残す。 | ブラウザ上で任意のログを解析する機能を作る際は、対象の計算を JavaScript へ移し、同じCSV・時間窓でR版の結果と突き合わせる。[R Project](https://www.r-project.org/about.html) |

## 飛行計算の精度と言語

現行のソルバーは JavaScript の `Number`（倍精度浮動小数点）を使い、固定刻みの中点法で位置・速度・姿勢・翼のたわみを進める。TypeScript の型注釈は実行時に消える。計算式と刻みが同じなら、型を付けても軌道は変わらない。機体諸元を追加する際には、角度の単位や必須項目の取り違えを検出する用途で型を使える。[ECMAScript の数値仕様](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-ecmascript-language-types-number-type)・[TypeScript の型注釈](https://www.typescriptlang.org/docs/handbook/2/basic-types.html#erased-types)・[積分処理](../src/domain/flight.js)

時間刻みの影響を確認するため、`dd499b8` のソースのコピーで `STEPS_PER_SECOND` だけを変えた。竜海の標準設計・基準風・基準操縦・正面発進を使い、各条件で `simulateFlight(BASE_DESIGN, modelHull(createAircraft()), { weather: 'reference' })` を接水まで実行した。小数点以下は計算同士の比較に必要な桁を示す。

| 積分周波数 | 飛距離 (m) | 接水時刻 (s) |
| ---: | ---: | ---: |
| 60 Hz | 421.088373 | 53.594277 |
| 120 Hz | 421.088338 | 53.594218 |
| 240 Hz | 421.088333 | 53.594203 |
| 480 Hz | 421.088333 | 53.594199 |

この条件では120 Hzから240 Hzへ変えたときの飛距離差は0.01 mm未満で、大会記録433.02 mと120 Hzの計算値には約11.93 mの差がある。基準操縦と風は大会ログから推定した条件なので、この比較で調べられるのは同じ飛行の再現までである。横風下の翼端接触や構造限界に近い試技では、飛行の終了理由も含めて刻みを変えた結果を確かめたい。[鳥科の機体諸元・大会記録](https://torica-tus.com/2025/11/14/2025/)・[離台時刻・計測位置・風の仮定](flight-validation.md)

## 実機との一致度を上げる順序

1. **竜海の高度・速度・姿勢を同じ条件で比べる。** 離台の基準時刻には約0.2秒の幅がある。センサー位置と測高方式を合わせ、離台から10秒、定常滑空、接水前の各区間で高度・対気速度・ピッチの偏りと二乗平均平方根誤差（RMSE）を出す。時刻の取り方で変わる誤差を併記すると、離台直後の沈み込みを係数の調整だけで合わせる危険を減らせる。[大会ログとの照合手順](flight-validation.md)・[計器を通した比較コード](../analysis/instrument-comparison.js)
2. **動きを左右する未計測値を絞る。** 離台時の角速度、体重移動、風、翼の剛性をそれぞれ資料の範囲で振り、上の区間誤差と接水時刻がどれだけ動くか調べる。複数の条件で同じ動きが出れば、次に必要な観測を明記する。QX-25ではまず設計者が述べた初期の頭上げと約5秒後の安定を照合し、翼の変形は三面図の設計たわみと荷重試験を基準にする。[九州大学の設計者による振り返り](https://q-birdman.lix.jp/2025/07/29/鳥人間コンテスト2025を振り返ってver-芝田/)・[QX-25 三面図](https://www.q-birdman.jp/history/images/qx-25.pdf)・[両機の構造資料と推定値](wing-structure.md)
3. **別の飛行で予測を確かめる。** 同じ機体で初期条件・操縦・風が記録された別試技を入手できたら、係数を固定して区間ごとの誤差を出す。それまでは基準試技への一致度と、仮定した風や操作を変えたときの感度を報告する。6自由度の運動方程式を独立に照合する候補には JSBSim がある。比較には機体ごとの質量・慣性・空力特性を与え、座標系、風、入力を揃える必要がある。[JSBSim 公式マニュアル](https://jsbsim-team.github.io/jsbsim-reference-manual/)

## 性能を理由に言語を替える場合

飛行計算は秒間120ステップ、軌跡の記録は秒間20サンプルで、どちらも画面のフレームレートとは別に決まる。スマホで動きが重い場合は、同じ端末・風・操縦入力で離台後10秒間を記録し、飛行計算のCPU時間、3D描画時間、初期の地形読み込みを切り分ける。CPUプロファイルと Three.js の `renderer.info` の描画回数・三角形数を併用できる。[Chrome DevTools の Performance](https://developer.chrome.com/docs/devtools/performance/overview)・[Three.js の描画統計](https://threejs.org/docs/pages/WebGLRenderer.html#info)

Mac（Apple M5、Node.js v26.8.1、モデル `dd499b8`）で、60 Hzの表示1フレーム分の飛行計算と姿勢の取得を測った。昼・中級、風の位相0、操縦は中立。各機の3Dモデルから接水判定用の外形を作り、離台後10秒を3回予熱、10回計測した。各機6,000フレームの所要時間は次の通り。初期化、岸線判定、GPU描画や操作画面を除いた値で、スマホでのフレーム時間は別途測る。[計測コード（`node analysis/flight-timing.js`）](../analysis/flight-timing.js)

| 機体 | 中央値 (ms) | 95パーセンタイル (ms) |
| --- | ---: | ---: |
| 竜海 | 0.015 | 0.018 |
| QX-25 | 0.012 | 0.014 |

60 Hz表示で使える約16.7 msのうち、このMacでの飛行計算は小さい。対象スマホで物理計算が繰り返しフレーム遅延の主因になった場合には、時間のかかる計算だけを Rust または C++ から WebAssembly にコンパイルして比べる。同じ端末で JS との受け渡しを含めた時間と、同一入力での軌跡・飛距離・接水時刻を照合して採否を決める。[WebAssembly の設計目標](https://webassembly.org/docs/high-level-goals/)

## Blender の原本と再利用

Blender の「プリファレンス → ファイルパス → アセットライブラリ」で、このリポジトリの `models/` を登録する。別作品ではアセットブラウザーからコレクションをドラッグする。「アペンド」を選ぶと、その作品で形や材質を編集できる。会場を丸ごと別の場所へコピーするときは、琵琶湖が相対リンクする発進台原本も含めて `models/` をコピーする。

| 原本 | 編集・配置できるもの |
| --- | --- |
| `models/flight-venues.blend` | `Lake Biwa` と `Fujikawa` の2シーン。追走車は車体・乗員・四輪・車内・3枚の鏡が一台に収まる。ボートには船体・操舵席・操船者・船外機がある。河川敷の建物15棟と草の株も個別に配置できる。 |
| `models/biwa-platform.blend` | `Launch Platform` に発進面、作業床、鋼管、岸までの搬入路、風見旗、掲示幕、夜間照明が入る。練習ブイは独立したコレクション。 |
| `models/ground-crew.blend` | 全身の地上クルー。髪型、服、靴、手足と動作用のリグをまとめて配置できる。助走・押す・離す・キャッチの動作原本を持ち、ゲームでは手を実際の把持点に、支持足を地面に合わせる。 |
| `models/cockpit-instruments.blend` | 聯の縦型GPSと、竜海・QX-25の横型飛行計器。各機体から相対リンクし、計器単体でも配置できる。 |
| `models/aircraft-{ryukai,qx25,ren}.blend` | 竜海、QX-25、聯の完成機。各原本が搭乗者、操縦席、計器、舵面と主翼の変形形状を持つ。 |

各原本はメートル単位。富士川の原点は滑走路南端で、Blender の +Y が滑走方向。850 × 30 m の滑走路、河口から富士山までの地形と航空写真をそろえた。河川敷の建物の位置・屋根の輪郭には航空写真を使い、軒高・扉・外装は推定で補った。琵琶湖の発進台は第48回ルールブックの予定図を基準に、先端高10 m、助走面10 m、勾配3.5°、床幅12 mを採った。車体内装と船上装備も参考形状による復元である。

### ゲーム用データの書き出し

リポジトリで `npm ci` を実行してから、編集した原本に対応するコマンドを使う。書き出し先は `assets/models/`。会場の書き出しは配信用の複製で固定部品を結合し、標高地形を圧縮し、植生の配置点をGPUインスタンスに変換する。会場の航空写真は配信用の `assets/terrain/` と `assets/fujikawa/` から参照する。

```sh
blender -b models/flight-venues.blend --python-exit-code 1 -P analysis/export-venues.py
blender -b models/biwa-platform.blend --python-exit-code 1 -P analysis/export-platform.py
blender -b models/ground-crew.blend --python-exit-code 1 -P analysis/export-ground-crew.py
blender -b models/aircraft-ren.blend --python-exit-code 1 -P analysis/export-aircraft.py
```

竜海・QX-25にも同じ `export-aircraft.py` を使う。ブラウザーは原本の支点や計器面を使って、飛行状態に応じた翼の変形、ペダルの回転、GPS表示、車輪とメーターの動き、車載ミラーの反射を更新する。湖面・川面・空は時刻、風、カメラに応じて描画する。
