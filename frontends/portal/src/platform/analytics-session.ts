export type AnalyticsScreen = 'games' | 'matches' | 'local' | 'game' | 'match' | 'account' | 'inbox';

/** Defer first use until idle. A sign-out or account switch can overtake that
 * first callback. Once started, publish changes in order and skip rerenders. */
export function deferredAnalytics(
  idle: (task: () => void) => void,
  publish: (id: string | null, screen: AnalyticsScreen) => void,
) {
  let current: string | null = null;
  let visible: AnalyticsScreen = 'games';
  let scheduled = false;
  let started = false;
  return (id: string | null, screen: AnalyticsScreen) => {
    if (current === id && (!id || visible === screen)) return;
    current = id;
    visible = screen;
    if (started) {
      publish(current, visible);
    } else if (id && !scheduled) {
      scheduled = true;
      idle(() => {
        scheduled = false;
        if (current) {
          started = true;
          publish(current, visible);
        }
      });
    }
  };
}
