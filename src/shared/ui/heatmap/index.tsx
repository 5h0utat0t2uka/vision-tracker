import { useId, useState } from "react";
import { type HeatmapMode, Heatmap } from "../../heatmap/Heatmap.ts";
import styles from "./index.module.css";

export function HeatmapControls({ heatmap }: { heatmap: Heatmap }) {
  const id = useId();
  const [visible, setVisible] = useState(heatmap.visible);
  const [mode, setMode] = useState<HeatmapMode>(heatmap.mode);
  const [opacity, setOpacity] = useState(heatmap.opacity);
  const [resetCount, setResetCount] = useState(0);
  return (
    <fieldset className={styles.controls}>
      <legend>Heatmap</legend>
      <label className={styles.row}>
        Display
        <input
          type="checkbox"
          checked={visible}
          onChange={(event) => {
            heatmap.visible = event.currentTarget.checked;
            setVisible(heatmap.visible);
          }}
        />
      </label>
      <label className={styles.row}>
        Metrics
        <select
          value={mode}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value !== "occupancy" && value !== "movement") return;
            heatmap.mode = value;
            setMode(value);
          }}
        >
          <option value="occupancy">occupancy</option>
          <option value="movement">movement</option>
        </select>
      </label>
      <label htmlFor={`${id}-opacity`}>Overlay：{Math.round(opacity * 100)}%</label>
      <input
        id={`${id}-opacity`}
        type="range"
        min={0.1}
        max={0.8}
        step={0.05}
        value={opacity}
        onChange={(event) => {
          heatmap.opacity = Number(event.currentTarget.value);
          setOpacity(heatmap.opacity);
        }}
      />
      {/*<div className={styles.gradient} aria-hidden="true" />*/}
      {/*<p className={styles.scale}>青：0付近 → 赤：{HEATMAP_SCALES[mode]}{mode === 'occupancy' ? '秒以上' : '%以上（画像対角長／区画）'}</p>*/}
      <p className={styles.hint}>
        {mode === "occupancy"
          ? "矩形で覆われた時間の累積で、重なった矩形は加算します。"
          : "中心の移動距離を経路上に配分します。画像の対角長を100%とし、実距離・速度ではありません。検出位置の揺れも含みます。"}
      </p>
      {/*<p className={styles.hint}>非表示中も両方を集計します。カメラ・解析条件の変更や中断時はリセットされます。固定カメラで使用してください。</p>*/}
      <button
        type="button"
        onClick={() => {
          heatmap.reset();
          setResetCount((count) => count + 1);
        }}
      >
        リセット
      </button>
      <span className={styles.hint} role="status">
        {resetCount > 0 ? `ヒートマップをリセットしました（${resetCount}回）` : ""}
      </span>
    </fieldset>
  );
}
