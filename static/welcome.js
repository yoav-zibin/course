"use strict";

(() => {
  const loginButton = document.getElementById("welcome-login");
  const guestForm = document.getElementById("welcome-guest-form");
  const guestInput = document.getElementById("welcome-guest-name");
  const guestButton = document.getElementById("welcome-guest");
  const message = document.getElementById("welcome-message");
  let navigating = false;

  function continueToGames() {
    if (navigating || !Auth.current()) return;
    navigating = true;
    // A page that sent a logged-out visitor here (e.g. pass-and-play on the
    // portal) names where to return to in ?next=; only same-site paths are
    // honored, anything else falls back to the games page.
    const next = new URLSearchParams(location.search).get("next");
    location.replace(
      next && next.startsWith("/") && !next.startsWith("//") ? next : "/portal",
    );
  }

  if (Auth.current()) {
    continueToGames();
    return;
  }

  document.addEventListener("auth-changed", continueToGames);
  loginButton.addEventListener("click", () => Auth.openDialog("login"));
  guestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    guestButton.disabled = true;
    try {
      Auth.upsert(await Auth.createGuest(guestInput.value));
      continueToGames();
    } catch (error) {
      message.textContent = error?.message || I18n.t("ui.welcome.guest_error", {}, "We couldn't create a guest account. Please try again.");
      guestButton.disabled = false;
    }
  });
})();
