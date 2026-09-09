# Vision Tracker
![Blob tracking visualization](./docs/blob-tracking-visualization.png)
This React app compares three client-side detection and tracking approaches: background subtraction, HSV color segmentation, and MediaPipe Tasks Vision. \
Camera frames are processed locally and are not uploaded.

## Features
- リアルタイムなカメラ映像の解析
- ブラウザのみで動作してインストール不要
- 映像を外部に送信せず端末内で完結
- ハードウェア（内部・外部カメラ）に依存しない
- 以下のような解析の用途に応用可能
  - 滞在・活動量の可視化 
  - 動線・ヒートマップ生成
  - 

## Routes
- `/` — tracking method selection
- `/background-subtraction`
  - Background Subtraction Blob Tracker  
  機械学習モデルやAIを利用せず Background Subtraction（背景差分）を利用した動体検出の Blob Track 実装

- `/color-segmentation`
  - HSV Color Segmentation Blob Tracking  
  機械学習モデルやAIを利用せず HSV色空間で特定の色の領域を抽出しして Blob Track を行う実装

- `/mediapipe-tasks-vision`
  - MediaPipe Tasks Vision Object Detection & Tracking  
  特定のオブジェクトを対象に MediaPipe Tasks Vision の Object Detectorを利用した実装

<!--## Region effect
3つの追跡ページのSettingsで `Grayscale` / `Invert` / `False color` / `None` を選択できます。初期値は `Grayscale` です。
`False color` は確定した矩形内の画素を明るさに応じて黒（0）→青（80）→シアン（150）→黄（200）→白（255）へ滑らかに配色します。温度の測定ではありません。
配色と境界値は `src/components/shared/rendering/falseColor.ts` の `FALSE_COLOR_STOPS` で管理します。sRGBのRGB値から `0.2126 R + 0.7152 G + 0.0722 B` で明るさを求め、WebGLのルックアップテクスチャで表示用のオフスクリーンCanvasだけを変換します。透明部分・矩形線・軌跡・元映像を用いる検出処理は変更しません。JavaScriptによる追加の画素読み戻しはありませんが、GPU描画・Canvas合成には処理負荷がかかります。WebGLを利用できない場合は、`False color`以外のRegion effectを選択してカメラを再起動してください。-->

## Background Subtraction Blob Track
1. `getUserMedia()`でカメラ映像を取得
2. `requestVideoFrameCallback()`で映像フレームに同期
3. 設定の `Analysis resolution` で長辺320px/480pxを選択し、元映像の縦横比を保ち解析用Canvasへ縮小
4. Running Background Modelによる背景差分
5. 選択した解析解像度に連動したopeningによる孤立ノイズ除去（320pxでは3×3、480pxでは5×5）
6. 8近傍Connected ComponentsによるBlob抽出
7. 距離・IoU・速度予測によるTrackとの1対1関連付け
8. `object-fit: cover`を考慮してOverlay Canvasへ描画

## HSV Color Segmentation Blob Track
1. 元映像を長辺320px（初期値）または480pxへ縮小し、RGB画素を取得
2. HSVへ変換し、選択色との差をH/S/Vの許容幅で判定。Hは0〜360°の循環距離、S/Vは0〜1で計算
3. 320pxでは3×3、480pxでは5×5のopeningで孤立ノイズを除去
4. 8近傍のBlob抽出、共通Trackerでの関連付け、矩形・軌跡の描画

## MediaPipe Tasks Vision Object Detection & Track
1. EfficientDet-Lite0 int8 v1＋CPU（初期値）とMediaPipe WASMを同一オリジンから読み込み。設定の`Inference backend`でfloat16 v1＋GPUへ切り替え可能
2. `requestVideoFrameCallback()`から既定10fps（5/10/15fpsから選択）で最新フレームを選択
3. `Inference resolution`で選んだ長辺320/480/640px以内（初期値640px）へ縦横比を維持して縮小した`ImageBitmap`をmodule Workerへtransferし、`detectForVideo()`をMain Thread外で実行
4. `categoryAllowlist`で人物（初期値）・車・自転車を複数選択
5. MediaPipeのbboxを元映像の座標へ戻して共通の`Detection`へ変換し、カテゴリが一致するTrackだけを関連付け
6. カメラ・カテゴリ・映像寸法・推論解像度の変更時は映像セッションの世代番号を更新し、古い非同期結果を破棄。モデル設定の要求番号は別に管理し、設定変更中の停止でも設定完了通知を受理
7. 推論結果の受信時だけ`BlobTracker`を更新し、`requestVideoFrameCallback()`で最新の追跡状態と映像を`OverlayRenderer`へ描画。再描画で観測回数やTrackの寿命を進めない

<!--バックエンド切り替え時は旧Detectorを解放し、Workerを作り直します。Trackと時間統計はリセットし、カメラ・カテゴリ・Confidence・解像度・FPS・描画設定は維持します。float16モデルはGPU選択時のみ取得します。GPU初期化・推論の失敗は画面に表示し、`Use CPU · int8`からCPUへ戻せます（自動フォールバックはしません）。モデルとdelegateの対応・初期値は`src/components/mediapipe-tasks-vision/config.ts`で管理します。GPUが必ず速いとは限らないため、同じ映像と設定で既存の平均・p95を比較してください。-->

<!--### Performance comparison
- 両方式の`Grayscale regions`でグレースケールだけを無効化できます。矩形・ID・軌跡は維持します。CSSの`backdrop-filter`方式は使用していません。
- MediaPipeでは推論と独立して映像を再描画します。描画回数は増えるため、軽量化を保証する変更ではありません。また矩形は最新の推論結果に基づくため、推論遅延による位置ずれは残ります。
- 両方式の時間統計は、**区間ごと**の直近120サンプルから平均とp95（nearest-rank）を約500msごとに表示します。MediaPipeの描画はカメラフレームごと、推論関連は有効な結果ごと、全体時間はその結果の最初の描画時だけ計測します。
- 背景差分では画像取得、背景更新・opening、Blob抽出、追跡、描画、全体を計測します。背景初期化中に実行しないBlob抽出・追跡はサンプルに含めません。背景差分の`CAPTURE`は`drawImage()`と`getImageData()`の時間、`PROCESSING`は画像取得開始から描画命令発行完了までです。
- グレースケール切り替えでは時間統計だけをリセットします。カメラ・映像寸法・解像度の切り替えでは追跡状態もリセットします。
- 同じ映像・対象端末の本番ビルドで解像度・FPS・グレースケールの有無を比較してください。区間ごとにサンプル数や期間が異なるため、平均やp95の合計を全体時間として扱わないでください。GPU・合成の負荷はブラウザのPerformance記録で別途確認します。
- 検出数の上限、関連付け方式、Trackごとの切り抜き方式は維持しています。背景差分のWorker化・空間分割・複数矩形の一括クリップは実測後の検討対象です。-->

<!--### Processing and metrics
- Workerが受付可能なときだけFPSスケジューラを進め、画像取得・推論は同時に1件までで、フレームをキューに蓄積しない
- MediaPipeのTrack保持時間は、最初に関連付けできない検出結果を受け取ったフレーム時刻から800msです。結果待ちだけではTrackを失効させず、未検出が続いて期限を超えたIDは再利用しません。カメラ・映像寸法・設定の変更や非表示への移行では追跡をリセットします。
- `INFERENCE_LONG_EDGE`と`INFERENCE_LONG_EDGES`（`src/components/mediapipe-tasks-vision/config.ts`）で推論画像の長辺上限の初期値・選択肢を管理します。カメラ表示の解像度は変えません。小さい物体の精度と処理速度は対象端末で比較してください。
- 両方式でフィルター用Canvasは最大DPR 1、矩形・文字用は最大DPR 2です。上限は`OverlayRenderer.ts`の`FILTER_MAX_PIXEL_RATIO`と`OVERLAY_MAX_PIXEL_RATIO`で調整できます。
- 時間統計は区間ごとに最新120件を保持します。

`WORKER ROUND TRIP`には`INFERENCE TIME`が含まれるため、両者は加算しません。スキップ数はセッション内の累計です。受付状態を先に判定するため、設定上は間引くフレームでも処理中なら`BUSY SKIPS`へ計上されます。この数値だけでは過負荷を意味しません。-->

| Metric | Measurement |
| :--- | :--- |
| CAPTURE | `createImageBitmap()`による画像取得・縮小を含む時間 |
| WORKER ROUND TRIP | main threadから送信して結果を受信するまで（Worker待ち・推論・結果変換を含む） |
| INFERENCE TIME | Worker内の`detectForVideo()`呼び出し時間（内部前処理も含む） |
| TRACKING TIME | 結果をTrackへ関連付ける時間 |
| DRAW SUBMISSION | Canvasへの描画命令発行時間。GPU処理・合成・画面への表示完了は含まない |
| CAPTURE TO FIRST DRAW | 画像取得開始から、その結果を初めて描画する命令の発行完了まで（次の映像フレームを待つ時間を含む） |
| BUSY SKIPS | 画像取得・推論中のため見送ったカメラフレーム数 |
| RATE SKIPS | 受付可能だが設定FPSの間隔を満たさず見送ったフレーム数 |

## References
- [Wikipedia: 背景差分](https://ja.wikipedia.org/wiki/背景差分)
- [OpenCV: Background Subtraction](https://docs.opencv.org/3.4.20/d8/d38/tutorial_bgsegm_bg_subtraction.html)
- [OpenCV: HSV range thresholding](https://docs.opencv.org/4.x/da/d97/tutorial_threshold_inRange.html)
- [Google for Developers: Object detection task guide](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector#efficientdet-lite0_model_recommended)
- [Media Capture and Streams](https://w3c.github.io/mediacapture-main/)
- [Video frame callbacks specification](https://wicg.github.io/video-rvfc/)
- [HTML Standard: video dimensions](https://html.spec.whatwg.org/multipage/media.html#dom-video-videowidth)
- [WebKit: `requestVideoFrameCallback()` support](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/)
- [WebKit: `willReadFrequently` support](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/#canvas)
- [Vite server options](https://v8.vite.dev/config/server-options)
- [MediaPipe Object Detector for Web](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/web_js)
- [MediaPipe Object Detector models](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector#models)
- [MediaPipe official Web Worker sample](https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/workers/object-detector.worker.ts)
- [React Router declarative routing](https://reactrouter.com/start/declarative/routing)
