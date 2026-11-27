// Partytown executes this file and the Google tag on its dedicated web worker.
(() => {
  const measurementId = 'G-6CCXZQYVE7';
  const disableKey = 'ga-disable-' + measurementId;
  let previous;
  let previousScreen;
  let initialized = false;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };

  // Read the current account when the worker runs. A slow download or queued
  // update must never resurrect an identity that has since signed out.
  window.buildPlaySyncAnalyticsIdentity = () => {
    const id = window.__buildPlayAnalyticsUser || null;
    const screen = window.__buildPlayAnalyticsScreen || null;
    const locationForReport = screen ? location.origin + '/portal/' + screen : location.origin + location.pathname;
    const changedUser = previous !== id;
    if (!changedUser && previousScreen === screen) return;
    previous = id;
    previousScreen = screen;
    if (!initialized) {
      if (!id || window[disableKey]) return;
      initialized = true;
      window.gtag('js', new Date());
      window.gtag('config', measurementId, {user_id: id, page_location: locationForReport,
        ...(screen ? {page_title:screen} : {})});
      const tag = document.createElement('script');
      tag.setAttribute('data-ptworkeronly', '');
      tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
      document.head.appendChild(tag);
    } else if (changedUser || (id && screen)) {
      window.gtag('config', measurementId, {user_id: id, update: true,
        ...(id && screen ? {page_title:screen,page_location:locationForReport} : {})});
    }
    if (id && screen && !window[disableKey]) {
      // The live GA4 web stream counts browser history pageviews automatically.
      // This event also covers screens such as Account that keep the same URL.
      window.gtag('event','portal_screen',{screen_name:screen,page_title:screen,page_location:locationForReport});
    }
  };
  window.buildPlaySyncAnalyticsIdentity();
})();
