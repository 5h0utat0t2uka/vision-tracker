import './App.css'
import { RegionEffectFilters } from './components/shared/rendering/RegionEffectFilters'
import { Link, Route, Routes } from 'react-router'
import { BackgroundSubtractionBlobTracker } from './routes/background-subtraction'
import { ColorSegmentationBlobTracker } from './routes/color-segmentation'
import { MediaPipeTasksVisionObjectTracker } from './routes/mediapipe-tasks-vision'

function App() {
  return (
    <>
      <RegionEffectFilters />
      <Routes>
        <Route index element={<Home />} />
        <Route path="background-subtraction" element={<BackgroundSubtractionBlobTracker />} />
        <Route path="color-segmentation" element={<ColorSegmentationBlobTracker />} />
        <Route path="mediapipe-tasks-vision" element={<MediaPipeTasksVisionObjectTracker />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  )
}

function Home() {
  return (
    <main className='common'>
      <section>
        <h1>Vision Tracker</h1>
        <p>This React app compares three client-side detection and tracking approaches: background subtraction, HSV color segmentation, and MediaPipe Tasks Vision. <br />Camera frames are processed locally and are not uploaded.</p>
        <div>
          <a href="https://github.com/5h0utat0t2uka/vision-tracker" target="_blank" rel="noopener noreferrer">
            <svg width={32} height={32} viewBox="0 0 32 32"><path fill="#e64a19" d="M13.172 2.828L11.78 4.22l1.91 1.91l2 2A2.986 2.986 0 0 1 20 10.81a3.25 3.25 0 0 1-.31 1.31l2.06 2a2.68 2.68 0 0 1 3.37.57a2.86 2.86 0 0 1 .88 2.117a3.02 3.02 0 0 1-.856 2.109A2.9 2.9 0 0 1 23 19.81a2.93 2.93 0 0 1-2.13-.87a2.694 2.694 0 0 1-.56-3.38l-2-2.06a3 3 0 0 1-.31.12V20a3 3 0 0 1 1.44 1.09a2.92 2.92 0 0 1 .56 1.72a2.88 2.88 0 0 1-.878 2.128a2.98 2.98 0 0 1-2.048.871a2.981 2.981 0 0 1-2.514-4.719A3 3 0 0 1 16 20v-6.38a2.96 2.96 0 0 1-1.44-1.09a2.9 2.9 0 0 1-.56-1.72a2.9 2.9 0 0 1 .31-1.31l-3.9-3.9l-7.579 7.572a4 4 0 0 0-.001 5.658l10.342 10.342a4 4 0 0 0 5.656 0l10.344-10.344a4 4 0 0 0 0-5.656L18.828 2.828a4 4 0 0 0-5.656 0"></path></svg>
            GitHub
          </a>
          <Link to="/privacy">
            <svg width={32} height={32} viewBox="0 0 32 32"><g fill="none"><path fill="url(#SVG0YxGxeQs)" d="M16.555 2.168a1 1 0 0 0-1.11 0C12.53 4.112 8.685 6.027 3.901 6.505A1 1 0 0 0 3 7.5V16c0 3.88 2.124 7.17 4.701 9.546c2.572 2.372 5.737 3.971 8.115 4.417l.184.034l.184-.034c2.378-.446 5.543-2.045 8.115-4.417C26.876 23.17 29 19.88 29 16V7.5a1 1 0 0 0-.9-.995c-4.785-.478-8.63-2.393-11.545-4.337"></path><defs><radialGradient id="SVG0YxGxeQs" cx={0} cy={0} r={1} gradientTransform="rotate(53.644 9.989 -14.008)scale(67.3559 60.0838)" gradientUnits="userSpaceOnUse"><stop offset={0.338} stopColor="#0fafff"></stop><stop offset={0.529} stopColor="#367af2"></stop><stop offset={0.682} stopColor="#5750e2"></stop><stop offset={0.861} stopColor="#cc23d1"></stop></radialGradient></defs></g></svg>
            Privacy
          </Link>
        </div>
        <nav aria-label="Tracking methods">
          <ul>
            <li>
              <Link to="/background-subtraction">Background Subtraction Blob Tracking</Link>
              <span>機械学習モデルやAIを利用せず 背景差分を利用して動体検出して追跡する Blob Track 実装</span>
            </li>
            <li>
              <Link to="/color-segmentation">Color Segmentation Blob Tracking</Link>
              <span>機械学習モデルやAIを利用せず HSV色空間で特定の色の領域を検出して追跡する Blob Track 実装</span>
            </li>
            <li>
              <Link to="/mediapipe-tasks-vision">MediaPipe Tasks Vision Object Detection Tracking</Link>
              <span>軽量な量子化済み学習モデルを利用して、特定のオブジェクト(人間・車・自転車のプリセット)を検出して追跡を行う MediaPipe Tasks Vision のた実装</span>
            </li>
          </ul>
        </nav>
      </section>
    </main>
  )
}

function Privacy() {
  return (
    <main className='common'>
      <section>
        <h1>Privacy</h1>
        <p>すべてのページのカメラ映像はブラウザ上で処理され、外部へは送信されません。<br /><a href="https://www.npmjs.com/package/@mediapipe/tasks-vision" target="_blank" rel="noopener noreferrer">@mediapipe/tasks-vision</a> を利用する <Link to="/mediapipe-tasks-vision">MediaPipe Tasks Vision Object Detection Tracking</Link> のページでは、性能および利用状況に関するメトリクスが Google へ送信されます。</p>
        <p>詳細は <a href="https://developers.google.com/edge/mediapipe/solutions/tasks?utm_source=chatgpt.com#mediapipe_tasks_privacy_notice" target="_blank" rel="noopener noreferrer">MediaPipe Tasks のドキュメント</a> または <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google のプライバシー</a>を確認ください。</p>
        <Link to="/">← Back</Link>
      </section>
    </main>
  )
}
function NotFoundPage() {
  return (
    <main className='common'>
      <section>
        <h1>404</h1>
        <p>ページが見つかりません</p>
        <Link to="/">← Back</Link>
      </section>
    </main>
  )
}

export default App
