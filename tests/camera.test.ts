import assert from "node:assert/strict";
import test from "node:test";
import { CameraSession, type CameraState } from "../src/camera/CameraSession.ts";

class FakeTrack extends EventTarget {
  readyState = "live";
  muted = false;
  stopCount = 0;
  stop(): void {
    this.stopCount += 1;
    this.readyState = "ended";
    // Like MediaStreamTrack.stop(), this must not dispatch an ended event.
  }
  getSettings() {
    return { width: 1280, height: 720, frameRate: 30, facingMode: "environment" };
  }
  end(): void {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
  setMuted(value: boolean): void {
    this.muted = value;
    this.dispatchEvent(new Event(value ? "mute" : "unmute"));
  }
}

class FakeVideo extends EventTarget {
  srcObject: MediaStream | null = null;
  videoWidth = 720;
  videoHeight = 1280;
  play: () => Promise<void> = () => Promise.resolve();
  pause(): void {}
}

function streamOf(...tracks: FakeTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks,
  } as unknown as MediaStream;
}

function setup(getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>) {
  const track = new FakeTrack();
  const stream = streamOf(track);
  const video = new FakeVideo();
  const states: CameraState[] = [];
  const session = new CameraSession(
    video as unknown as HTMLVideoElement,
    (state) => states.push(state),
    getUserMedia ?? (() => Promise.resolve(stream)),
  );
  return { session, video, track, stream, states };
}

test("開始待ち中のstopは遅れて取得された全trackを解放する", async () => {
  const acquisition = Promise.withResolvers<MediaStream>();
  const { session, video, states } = setup(() => acquisition.promise);
  const start = session.start();
  session.stop();
  const first = new FakeTrack();
  const second = new FakeTrack();
  acquisition.resolve(streamOf(first, second));
  await start;
  assert.equal(states.at(-1)?.status, "idle");
  assert.equal(video.srcObject, null);
  assert.equal(first.stopCount, 1);
  assert.equal(second.stopCount, 1);
});

test("play待ち中のstop後にplayが成功してもrunningへ戻らない", async () => {
  const { session, video, states, track } = setup();
  const playback = Promise.withResolvers<void>();
  video.play = () => playback.promise;
  const start = session.start();
  await Promise.resolve();
  session.stop();
  playback.resolve();
  await start;
  assert.deepEqual(
    states.map((state) => state.status),
    ["requesting", "idle"],
  );
  assert.equal(track.stopCount, 1);
  assert.equal(video.srcObject, null);
});

test("dispose後のplay完了は状態を更新しない", async () => {
  const { session, video, states, track } = setup();
  const playback = Promise.withResolvers<void>();
  video.play = () => playback.promise;
  const start = session.start();
  await Promise.resolve();
  session.dispose();
  playback.resolve();
  await start;
  await session.start();
  assert.equal(states.length, 1);
  assert.equal(track.stopCount, 1);
});

test("古い取得要求の成功は新しいstreamを上書き・停止しない", async () => {
  const oldAcquisition = Promise.withResolvers<MediaStream>();
  const newTrack = new FakeTrack();
  const newStream = streamOf(newTrack);
  let calls = 0;
  const { session, video, states } = setup(() =>
    ++calls === 1 ? oldAcquisition.promise : Promise.resolve(newStream),
  );
  const oldStart = session.start();
  await session.start();
  const oldTrack = new FakeTrack();
  oldAcquisition.resolve(streamOf(oldTrack));
  await oldStart;
  assert.equal(video.srcObject, newStream);
  assert.equal(newTrack.stopCount, 0);
  assert.equal(oldTrack.stopCount, 1);
  assert.equal(states.at(-1)?.status, "running");
  session.dispose();
});

test("古いplay要求の失敗は新しいstreamを停止しない", async () => {
  const tracks = [new FakeTrack(), new FakeTrack()];
  const streams = tracks.map((track) => streamOf(track));
  let calls = 0;
  const { session, video, states } = setup(() => Promise.resolve(streams[calls++]));
  const oldPlayback = Promise.withResolvers<void>();
  video.play = () => oldPlayback.promise;
  const oldStart = session.start();
  await Promise.resolve();
  video.play = () => Promise.resolve();
  await session.start();
  oldPlayback.reject(new DOMException("Aborted", "AbortError"));
  await oldStart;
  assert.equal(states.at(-1)?.status, "running");
  assert.equal(video.srcObject, streams[1]);
  assert.equal(tracks[0].stopCount, 1);
  assert.equal(tracks[1].stopCount, 0);
  session.dispose();
});

test("mute/unmuteは一時中断と再開を通知し、endedは解放してエラーにする", async () => {
  const { session, video, states, track } = setup();
  await session.start();
  assert.equal(states.at(-1)?.status, "running");
  assert.deepEqual(states.at(-1)?.info, {
    width: 720,
    height: 1280,
    frameRate: 30,
    facingMode: "environment",
  });
  track.setMuted(true);
  assert.equal(states.at(-1)?.status, "suspended");
  track.setMuted(false);
  assert.equal(states.at(-1)?.status, "running");
  track.end();
  assert.equal(states.at(-1)?.status, "error");
  assert.equal(track.stopCount, 1);
  assert.equal(video.srcObject, null);
  const count = states.length;
  track.setMuted(false);
  video.dispatchEvent(new Event("resize"));
  assert.equal(states.length, count);
});

test("play完了前のmute/endedも見落とさない", async () => {
  for (const ends of [false, true]) {
    const { session, video, states, track } = setup();
    const playback = Promise.withResolvers<void>();
    video.play = () => playback.promise;
    const start = session.start();
    await Promise.resolve();
    if (ends) track.end();
    else track.setMuted(true);
    playback.resolve();
    await start;
    assert.equal(states.at(-1)?.status, ends ? "error" : "suspended");
    session.dispose();
  }
});

test("再生失敗・取得済みtrack終了・空streamは資源を解放する", async () => {
  const { session, video, states, track } = setup();
  video.play = () => Promise.reject(new DOMException("Denied", "NotAllowedError"));
  await session.start();
  assert.equal(states.at(-1)?.status, "error");
  assert.equal(track.stopCount, 1);
  assert.equal(video.srcObject, null);
  const ended = new FakeTrack();
  ended.readyState = "ended";
  for (const stream of [streamOf(ended), streamOf()]) {
    const other = setup(() => Promise.resolve(stream));
    await other.session.start();
    assert.equal(other.states.at(-1)?.status, "error");
    assert.equal(other.video.srcObject, null);
  }
});

test("停止後のtrackイベントは無効で、映像の寸法変更はinfoに反映する", async () => {
  const { session, video, states, track } = setup();
  await session.start();
  video.videoWidth = 1280;
  video.videoHeight = 720;
  video.dispatchEvent(new Event("resize"));
  assert.equal(states.at(-1)?.info?.width, 1280);
  session.stop();
  const count = states.length;
  track.end();
  track.setMuted(false);
  assert.equal(states.length, count);
  assert.equal(states.at(-1)?.status, "idle");
});

test("取得条件は映像のみで、音声を要求しない", async () => {
  let constraints: MediaStreamConstraints | undefined;
  const track = new FakeTrack();
  const { session } = setup((value) => {
    constraints = value;
    return Promise.resolve(streamOf(track));
  });
  await session.start();
  assert.equal(constraints?.audio, false);
  assert.deepEqual(constraints?.video, {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
  });
  session.dispose();
});

test("選択したカメラはdeviceIdで明示的に要求する", async () => {
  let constraints: MediaStreamConstraints | undefined;
  const { session } = setup((value) => {
    constraints = value;
    return Promise.resolve(streamOf(new FakeTrack()));
  });
  await session.start("external-camera");
  assert.deepEqual(constraints?.video, {
    deviceId: { exact: "external-camera" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
  });
  session.dispose();
});
