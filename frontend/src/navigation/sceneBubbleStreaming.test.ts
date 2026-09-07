import { SceneContext } from '../types';
import { SceneBubbleStreamer } from './sceneBubbleStreaming';

const scene = (): SceneContext => ({
  buildings: [], signals: [], crossings: [], stops: [], trees: [], restrictions: [], roads: [],
});

test('refreshes only after the configured movement threshold', async () => {
  const streamer = new SceneBubbleStreamer({ refreshDistanceMeters: 100 });
  let calls = 0;
  const fetcher = async () => { calls += 1; return scene(); };
  await streamer.ensure({ lat: 0, lng: 0 }, fetcher);
  await streamer.ensure({ lat: 0, lng: 0.0004 }, fetcher);
  expect(calls).toBe(1);
  await streamer.ensure({ lat: 0, lng: 0.0011 }, fetcher);
  expect(calls).toBe(2);
});

test('serves the current cached bubble without refetching', async () => {
  const streamer = new SceneBubbleStreamer({ refreshDistanceMeters: 50 });
  let calls = 0;
  const fetcher = async () => { calls += 1; return scene(); };
  await streamer.ensure({ lat: 0, lng: 0 }, fetcher);
  await streamer.ensure({ lat: 0, lng: 0.0001 }, fetcher);
  expect(calls).toBe(1);
  expect(streamer.cacheSize).toBe(1);
});

test('newer request wins when an older request resolves late', async () => {
  const streamer = new SceneBubbleStreamer({ refreshDistanceMeters: 1 });
  const resolvers: Array<(value: SceneContext) => void> = [];
  const fetcher = () => new Promise<SceneContext>((resolve) => resolvers.push(resolve));
  const first = streamer.ensure({ lat: 0, lng: 0 }, fetcher);
  const second = streamer.ensure({ lat: 0, lng: 0.002 }, fetcher);
  resolvers[1](scene());
  await second;
  resolvers[0](scene());
  expect(await first).toBeNull();
  expect(streamer.state().center?.lng).toBeCloseTo(0.002);
});
