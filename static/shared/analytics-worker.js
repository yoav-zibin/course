// Partytown executes this file and the Google tag on its dedicated web worker.
(() => {
  const measurementId = 'G-6CCXZQYVE7';
  const disableKey = 'ga-disable-' + measurementId;
  let previous;
  let initialized = false;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };

  // Read the current account when the worker runs. A slow download or queued
  // update must never resurrect an identity that has since signed out.
  window.buildPlaySyncAnalyticsIdentity = () => {
    const id = window.__buildPlayAnalyticsUser || null;
    if (previous === id) return;
    previous = id;
    if (!initialized) {
      if (!id || window[disableKey]) return;
      initialized = true;
      window.gtag('js', new Date());
      window.gtag('config', measurementId, {user_id: id, page_location: location.origin + location.pathname});
      const tag = document.createElement('script');
      tag.setAttribute('data-ptworkeronly', '');
      tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
      document.head.appendChild(tag);
    } else {
      window.gtag('config', measurementId, {user_id: id, update: true});
    }
  };
  window.buildPlaySyncAnalyticsIdentity();
})();
