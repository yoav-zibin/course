(() => {
  if (window.location.hostname !== 'buildplay.fun') return;

  const measurementId = 'G-6CCXZQYVE7';
  const disableKey = 'ga-disable-' + measurementId;
  let tracked = false;
  let closed = false;

  function clearUser() {
    if (closed) return;
    closed = true;
    if (!tracked) return;
    window[disableKey] = true;
    window.gtag('config', measurementId, {user_id: null, update: true});
  }

  function trackSession(session) {
    const userId = session.user?.id;
    if (closed || tracked || session.signed_in !== true || typeof userId !== 'string' ||
        !userId || !(session.expires_in_seconds > 0)) return;
    tracked = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', measurementId, {user_id: userId});

    const tag = document.createElement('script');
    tag.async = true;
    tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
    document.head.appendChild(tag);
    window.setTimeout(clearUser, session.expires_in_seconds * 1000);
  }

  window.BuildPlayAnalytics = {trackSession, clearUser};
  if (document.currentScript.hasAttribute('data-admin-session')) {
    fetch('/auth/admin-session', {credentials: 'same-origin', cache: 'no-store'})
      .then(response => response.ok ? response.json() : null)
      .then(session => { if (session) trackSession(session); })
      .catch(() => {});
  }
})();
