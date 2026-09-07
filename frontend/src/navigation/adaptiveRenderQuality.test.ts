import { AdaptiveRenderQuality } from './adaptiveRenderQuality';

describe('AdaptiveRenderQuality', () => {
  it('downgrades only after sustained slow frames', () => {
    const q = new AdaptiveRenderQuality({ downgradeFrames: 4 });
    for (let i = 0; i < 3; i++) q.update(35);
    expect(q.getTier()).toBe('high');
    q.update(35);
    expect(q.getTier()).toBe('balanced');
  });

  it('requires sustained headroom before upgrading', () => {
    const q = new AdaptiveRenderQuality({ downgradeFrames: 2, upgradeFrames: 5 });
    q.update(40); q.update(40);
    expect(q.getTier()).toBe('balanced');
    for (let i = 0; i < 4; i++) q.update(10);
    expect(q.getTier()).toBe('balanced');
    q.update(10);
    expect(q.getTier()).toBe('high');
  });

  it('does not oscillate around the threshold', () => {
    const q = new AdaptiveRenderQuality({ downgradeFrames: 3, upgradeFrames: 5 });
    for (let i = 0; i < 20; i++) q.update(i % 2 ? 19 : 23);
    expect(q.getTier()).toBe('high');
  });
});
