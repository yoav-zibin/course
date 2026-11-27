(() => {
  if (location.hostname !== 'buildplay.fun') return;

  const measurementId = 'G-6CCXZQYVE7';
  const disableKey = 'ga-disable-' + measurementId;
  let requested = false;
  let sessionClosed = false;
  let pausedForSignOut = false;

  function startWorker() {
    if (requested || !window.__buildPlayAnalyticsUser || window[disableKey] ||
        !window.Worker || !navigator.serviceWorker) return;
    requested = true;
    window.partytown = {
      lib: '/static/app/analytics-worker/',
      fallbackTimeout: 0,
      forward: ['buildPlaySyncAnalyticsIdentity'],
      mainWindowAccessors: ['__buildPlayAnalyticsUser', disableKey],
    };
    // A denied worker registration must skip analytics. Partytown recognizes
    // this attribute on scripts that may execute only inside its worker.
    const setup = document.createElement('script');
    setup.type = 'text/partytown';
    setup.setAttribute('data-ptworkeronly', '');
    setup.src = '/static/shared/analytics-worker.js?v=1';
    document.head.appendChild(setup);
    const loader = document.createElement('script');
    loader.async = true;
    loader.fetchPriority = 'low';
    loader.src = window.partytown.lib + 'partytown.js';
    document.head.appendChild(loader);
  }

  function afterLoadWhenIdle(task) {
    const schedule = () => {
      if (window.requestIdleCallback) window.requestIdleCallback(task);
      else window.setTimeout(task, 0);
    };
    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', schedule, {once: true});
  }

  let scheduled = false;
  function setUser(userId) {
    const id = typeof userId === 'string' && userId ? userId : null;
    if (window.__buildPlayAnalyticsUser === id) return;
    window.__buildPlayAnalyticsUser = id;
    if (!id && window[disableKey] !== true) {
      window[disableKey] = true;
      pausedForSignOut = true;
    } else if (id && pausedForSignOut) {
      window[disableKey] = false;
      pausedForSignOut = false;
    }
    if (requested) {
      window.buildPlaySyncAnalyticsIdentity?.();
    } else if (id && !scheduled) {
      scheduled = true;
      afterLoadWhenIdle(() => { scheduled = false; startWorker(); });
    }
  }

  function clearUser() {
    sessionClosed = true;
    setUser(null);
  }

  function trackSession(session) {
    if (sessionClosed || session?.signed_in !== true || !session.user?.id || !(session.expires_in_seconds > 0)) return;
    setUser(session.user.id);
    window.setTimeout(clearUser, session.expires_in_seconds * 1000);
  }

  window.BuildPlayAnalytics = {setUser, trackSession, clearUser};
  if (document.currentScript?.hasAttribute('data-admin-session')) {
    afterLoadWhenIdle(() => {
      if (sessionClosed) return;
      fetch('/auth/admin-session', {credentials: 'same-origin', cache: 'no-store', priority: 'low'})
        .then(response => response.ok ? response.json() : null)
        .then(trackSession)
        .catch(() => {});
    });
  }
})();
