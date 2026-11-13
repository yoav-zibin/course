// Loaded only when the visitor chooses ?login=quick-play. No saved preference.
"use strict";
(async () => {
  await I18n.ready;
  const main = document.querySelector(".welcome-content");
  const title = document.getElementById("welcome-title");
  const intro = main.querySelector(".welcome-intro");
  [title, intro].forEach(node => node.removeAttribute("data-i18n"));
  const options = main.querySelector(".welcome-options");
  options.className = "quick-play-actions";
  const style = document.createElement("link");
  style.rel = "stylesheet"; style.href = "/static/quick-play-login.css?v=1";
  document.head.appendChild(style);
  main.classList.add("quick-play-login");
  const status = document.getElementById("welcome-message");
  const makeButton = (text, fn, primary = false) =>
    el("button", {type:"button", textContent:text, class:primary ? "primary" : "", onclick:fn});
  const back = (label, fn) => makeButton(label, fn);
  const next = new URLSearchParams(location.search).get("next");
  let target = new URL("/portal", location.origin);
  if (next?.startsWith("/") && !next.startsWith("//")) {
    try { const url = new URL(next, location.origin); if (url.origin === location.origin) target = url; } catch {}
  }
  const params = new URLSearchParams(target.hash.slice(1));
  const invite = params.get("invite"), match = params.get("match"), joining = Boolean(invite || match);
  let gameName = "", screen = "", revision = 0, config, navigating = false;
  function done() {
    if (navigating || !Auth.current()) return;
    navigating = true; location.replace(target.href);
  }
  if (Auth.current()) { done(); return; }
  document.addEventListener("auth-changed", done);
  function show(key, heading, detail, ...nodes) {
    screen = key; ++revision;
    title.textContent = heading; intro.textContent = detail;
    status.textContent = ""; options.replaceChildren(...nodes);
    title.tabIndex = -1; title.focus({preventScroll:true});
  }
  async function submit(fn) {
    const stamp = revision;
    if (options.inert) return;
    const controls = [...options.querySelectorAll("button,input")];
    controls.forEach(control => control.disabled = true);
    options.inert = true; options.setAttribute("aria-busy","true"); status.textContent = I18n.t("ui.quickplay.wait", {}, "Please wait…");
    try { await fn(); }
    catch (error) { if (stamp === revision) status.textContent = error.message || I18n.t("ui.quickplay.retry", {}, "Please try again."); }
    finally { controls.forEach(control => control.disabled = false); options.inert = false; options.removeAttribute("aria-busy"); }
  }
  const guest = () => submit(async () => Auth.upsert(await Auth.createGuest()));
  function home() {
    const play = makeButton(I18n.t("ui.quickplay.guest", {}, "Play as a guest"), guest, joining);
    const sign = makeButton(I18n.t("ui.quickplay.existing", {}, "Sign in to an existing account"), methods, !joining);
    const help = el("small", {}, I18n.t("ui.quickplay.later", {}, "Start now. Link a sign-in method later."));
    show("home", joining ? I18n.t("ui.quickplay.join", {}, "Join this match") : I18n.t("ui.quickplay.signin", {}, "Sign in to BuildPlay"),
      gameName ? I18n.t("ui.quickplay.invited_game", {game:gameName}, "You’re invited to play {game}.") : joining ? I18n.t("ui.quickplay.invite_choice", {}, "Choose how to join the match.") : I18n.t("ui.quickplay.welcome", {}, "Pick up where you left off, or start a game as a guest."),
      ...(joining ? [play,help,sign] : [sign,play,help]));
  }
  async function methods() {
    show("methods",I18n.t("ui.quickplay.signin", {}, "Sign in to BuildPlay"),I18n.t("ui.quickplay.methods", {}, "Choose a sign-in method."),back(I18n.t("ui.quickplay.back", {}, "Back"),home));
    const stamp = revision;
    try {
      config = await apiRequest("GET","/auth/config");
      if (stamp !== revision) return;
      const buttons = [];
      if (config.google_client_id) buttons.push(makeButton(I18n.t("ui.quickplay.google", {}, "Continue with Google"),google));
      if (config.email_login_enabled) buttons.push(makeButton(I18n.t("ui.quickplay.email", {}, "Continue with email"),()=>contact("email")));
      if (config.phone_login_enabled) buttons.push(makeButton(I18n.t("ui.quickplay.phone", {}, "Continue with phone"),()=>contact("phone")));
      options.prepend(...buttons);
      if (!buttons.length) status.textContent=I18n.t("ui.quickplay.no_methods", {}, "No sign-in methods are available. You can still play as a guest.");
    } catch { if (stamp===revision) options.prepend(makeButton(I18n.t("ui.quickplay.retry_methods", {}, "Retry sign-in options"),methods)); }
  }
  async function google() {
    const holder=el("div");
    show("google",I18n.t("ui.quickplay.google", {}, "Continue with Google"),I18n.t("ui.quickplay.google_choice", {}, "Choose your Google account."),holder,back(I18n.t("ui.quickplay.other_methods", {}, "Other sign-in methods"),methods));
    const stamp=revision;
    try {
      if (!window.google?.accounts?.id) await new Promise((resolve,reject)=>{
        const s=document.createElement("script");s.src="https://accounts.google.com/gsi/client";
        s.onload=resolve;s.onerror=reject;document.head.appendChild(s);
      });
      if(stamp!==revision)return;
      window.google.accounts.id.initialize({client_id:config.google_client_id,auto_select:false, callback:({credential})=>{
        if(stamp===revision) submit(async()=>Auth.upsert(await apiRequest("POST","/auth/google",{body:Auth.newAccountBody({id_token:credential})})));
      }});
      window.google.accounts.id.renderButton(holder,{theme:"outline",size:"large"});
    } catch { if(stamp===revision) status.textContent=I18n.t("ui.quickplay.google_error", {}, "Google sign-in could not load. Try another method."); }
  }
  function contact(kind,value="") {
    const phone=kind==="phone", field=phone?"phone_number":"email", path="/auth/"+kind;
    const input=el("input",{type:phone?"tel":"email",autocomplete:phone?"tel":"email",value,required:true,placeholder:phone?"+15551234567":"you@example.com"});
    const form=el("form",{},el("label",{},phone?I18n.t("ui.auth.phone", {}, "Phone number"):I18n.t("ui.quickplay.email_address", {}, "Email address"),input),
      el("button",{type:"submit",class:"primary",textContent:phone?I18n.t("ui.auth.text_me_code", {}, "Text me a code"):I18n.t("ui.auth.email_me_code", {}, "Email me a code")}));
    function send(destination,channel) {
      return submit(async()=>{
        const started=await apiRequest("POST",path+"/start",{body:{[field]:destination,...(phone?{delivery_method:channel}:{})}});
        const masked=phone?"•••• "+destination.slice(-4):destination.replace(/^(.).*?@/,"$1•••@");
        const code=el("input",{type:"text",inputMode:"numeric",autocomplete:"one-time-code",pattern:"[0-9]{6}",maxLength:6,required:true});
        const check=el("form",{},el("label",{},I18n.t("ui.quickplay.code", {}, "6-digit code"),code),el("button",{type:"submit",class:"primary",textContent:joining?I18n.t("ui.quickplay.verify_join", {}, "Verify and join"):I18n.t("ui.quickplay.verify_signin", {}, "Verify and sign in")}));
        check.onsubmit=e=>{e.preventDefault();submit(async()=>Auth.upsert(await apiRequest("POST",path+"/verify",{body:Auth.newAccountBody({verification_id:started.verification_id,code:code.value})})));};
        show("verify",I18n.t("ui.quickplay.enter_code", {}, "Enter your code"),I18n.t("ui.quickplay.code_sent", {destination:masked, minutes:Math.ceil(started.expires_in_seconds/60)}, "Sent to {destination} · expires in {minutes} minutes."),check,
          back(phone?I18n.t("ui.quickplay.change_phone", {}, "Change number"):I18n.t("ui.quickplay.change_email", {}, "Change email"),()=>contact(kind,destination)),makeButton(I18n.t("ui.quickplay.resend_code", {}, "Send another code"),()=>send(destination,channel)));
        queueMicrotask(()=>code.focus());
      });
    }
    form.onsubmit=e=>{e.preventDefault();send(input.value.trim(),"sms");};
    if(phone && config.phone_call_enabled) form.append(makeButton(I18n.t("ui.auth.call_me", {}, "Call me with a code"),()=>{if(form.reportValidity())send(input.value.trim(),"call");}));
    show("contact",phone?I18n.t("ui.quickplay.phone", {}, "Continue with phone"):I18n.t("ui.quickplay.email", {}, "Continue with email"),I18n.t("ui.quickplay.code_hint", {}, "We’ll send you a verification code."),form,back(I18n.t("ui.quickplay.other_methods", {}, "Other sign-in methods"),methods));
    input.focus();
  }
  home();
  if(joining) (async()=>{
    const info=await apiRequest("GET",invite?"/invites/"+encodeURIComponent(invite):"/matches/"+encodeURIComponent(match));
    gameName=info.game_name || (info.game_id && (await apiRequest("GET","/games/"+encodeURIComponent(info.game_id))).name) || "";
    if(screen==="home" && gameName) intro.textContent=I18n.t("ui.quickplay.invited_game", {game:gameName}, "You’re invited to play {game}.");
  })().catch(()=>{});
})();
