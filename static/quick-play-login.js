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
  const translations = new Map();
  function translated(node, text) {
    translations.set(node, text);
    node.textContent = text();
    return node;
  }
  function refreshTexts() {
    for (const [node, text] of translations) {
      if (node.isConnected) node.textContent = text();
      else translations.delete(node);
    }
  }
  document.addEventListener("i18n-changed", refreshTexts);
  const copy = {
    wait: () => I18n.t("ui.quickplay.wait", {}, "Please wait…"),
    retry: () => I18n.t("ui.quickplay.retry", {}, "Please try again."),
    guest: () => I18n.t("ui.quickplay.guest", {}, "Play as a guest"),
    existing: () => I18n.t("ui.quickplay.existing", {}, "Sign in to an existing account"),
    later: () => I18n.t("ui.quickplay.later", {}, "Start now. Link a sign-in method later."),
    join: () => I18n.t("ui.quickplay.join", {}, "Join this match"),
    signin: () => I18n.t("ui.quickplay.signin", {}, "Sign in to BuildPlay"),
    invited: () => I18n.t("ui.quickplay.invited_game", {game: gameName}, "You’re invited to play {game}."),
    chooseJoin: () => I18n.t("ui.quickplay.invite_choice", {}, "Choose how to join the match."),
    intro: () => I18n.t("ui.quickplay.welcome", {}, "Pick up where you left off, or start a game as a guest."),
    chooseMethod: () => I18n.t("ui.quickplay.methods", {}, "Choose a sign-in method."),
    back: () => I18n.t("ui.quickplay.back", {}, "Back"),
    google: () => I18n.t("ui.quickplay.google", {}, "Continue with Google"),
    email: () => I18n.t("ui.quickplay.email", {}, "Continue with email"),
    phone: () => I18n.t("ui.quickplay.phone", {}, "Continue with phone"),
    noMethods: () => I18n.t("ui.quickplay.no_methods", {}, "No sign-in methods are available. You can still play as a guest."),
    retryMethods: () => I18n.t("ui.quickplay.retry_methods", {}, "Retry sign-in options"),
    googleChoose: () => I18n.t("ui.quickplay.google_choice", {}, "Choose your Google account."),
    otherMethods: () => I18n.t("ui.quickplay.other_methods", {}, "Other sign-in methods"),
    googleFailed: () => I18n.t("ui.quickplay.google_error", {}, "Google sign-in could not load. Try another method."),
    phoneLabel: () => I18n.t("ui.auth.phone", {}, "Phone number"),
    emailLabel: () => I18n.t("ui.quickplay.email_address", {}, "Email address"),
    textCode: () => I18n.t("ui.auth.text_me_code", {}, "Text me a code"),
    emailCode: () => I18n.t("ui.auth.email_me_code", {}, "Email me a code"),
    codeLabel: () => I18n.t("ui.quickplay.code", {}, "6-digit code"),
    verifyJoin: () => I18n.t("ui.quickplay.verify_join", {}, "Verify and join"),
    verifySignin: () => I18n.t("ui.quickplay.verify_signin", {}, "Verify and sign in"),
    enterCode: () => I18n.t("ui.quickplay.enter_code", {}, "Enter your code"),
    changePhone: () => I18n.t("ui.quickplay.change_phone", {}, "Change number"),
    changeEmail: () => I18n.t("ui.quickplay.change_email", {}, "Change email"),
    resend: () => I18n.t("ui.quickplay.resend_code", {}, "Send another code"),
    contactHint: () => I18n.t("ui.quickplay.code_hint", {}, "We’ll send you a verification code."),
    callCode: () => I18n.t("ui.auth.call_me", {}, "Call me with a code"),
  };
  const makeButton = (text, fn, primary = false) =>
    translated(el("button", {type:"button", class:primary ? "primary" : "", onclick:fn}), text);
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
    translated(title, heading); translated(intro, detail);
    translations.delete(status); status.textContent = ""; options.replaceChildren(...nodes);
    refreshTexts();
    title.tabIndex = -1; title.focus({preventScroll:true});
  }
  async function submit(fn) {
    const stamp = revision;
    if (options.inert) return;
    const controls = [...options.querySelectorAll("button,input")];
    controls.forEach(control => control.disabled = true);
    options.inert = true; options.setAttribute("aria-busy","true"); translated(status, copy.wait);
    try { await fn(); }
    catch (error) {
      if (stamp === revision) {
        if (error.message) { translations.delete(status); status.textContent = error.message; }
        else translated(status, copy.retry);
      }
    }
    finally {
      controls.forEach(control => control.disabled = false);
      options.inert = false; options.removeAttribute("aria-busy");
      // The new code form cannot receive focus until its inert parent is enabled.
      if (stamp !== revision && screen === "verify") options.querySelector('input[autocomplete="one-time-code"]')?.focus();
    }
  }
  const guest = () => submit(async () => Auth.upsert(await Auth.createGuest()));
  function home() {
    const play = makeButton(copy.guest, guest, joining);
    const sign = makeButton(copy.existing, methods, !joining);
    const help = translated(el("small"), copy.later);
    show("home", joining ? copy.join : copy.signin,
      gameName ? copy.invited : joining ? copy.chooseJoin : copy.intro,
      ...(joining ? [play,help,sign] : [sign,play,help]));
  }
  async function methods() {
    show("methods",copy.signin,copy.chooseMethod,back(copy.back,home));
    const stamp = revision;
    try {
      config = await apiRequest("GET","/auth/config");
      if (stamp !== revision) return;
      const buttons = [];
      if (config.google_client_id) buttons.push(makeButton(copy.google,google));
      if (config.email_login_enabled) buttons.push(makeButton(copy.email,()=>contact("email")));
      if (config.phone_login_enabled) buttons.push(makeButton(copy.phone,()=>contact("phone")));
      options.prepend(...buttons);
      if (!buttons.length) translated(status, copy.noMethods);
    } catch { if (stamp===revision) options.prepend(makeButton(copy.retryMethods,methods)); }
  }
  async function google() {
    const holder=el("div");
    show("google",copy.google,copy.googleChoose,holder,back(copy.otherMethods,methods));
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
    } catch { if(stamp===revision) translated(status,copy.googleFailed); }
  }
  function contact(kind,value="") {
    const phone=kind==="phone", field=phone?"phone_number":"email", path="/auth/"+kind;
    const input=el("input",{type:phone?"tel":"email",autocomplete:phone?"tel":"email",value,required:true,placeholder:phone?"+15551234567":"you@example.com"});
    const form=el("form",{},el("label",{},translated(el("span"),phone?copy.phoneLabel:copy.emailLabel),input),
      translated(el("button",{type:"submit",class:"primary"}),phone?copy.textCode:copy.emailCode));
    function send(destination,channel) {
      return submit(async()=>{
        const started=await apiRequest("POST",path+"/start",{body:{[field]:destination,...(phone?{delivery_method:channel}:{})}});
        const masked=phone?"•••• "+destination.slice(-4):destination.replace(/^(.).*?@/,"$1•••@");
        const code=el("input",{type:"text",inputMode:"numeric",autocomplete:"one-time-code",pattern:"[0-9]{6}",maxLength:6,required:true});
        const check=el("form",{},el("label",{},translated(el("span"),copy.codeLabel),code),translated(el("button",{type:"submit",class:"primary"}),joining?copy.verifyJoin:copy.verifySignin));
        check.onsubmit=e=>{e.preventDefault();submit(async()=>Auth.upsert(await apiRequest("POST",path+"/verify",{body:Auth.newAccountBody({verification_id:started.verification_id,code:code.value})})));};
        show("verify",copy.enterCode,()=>I18n.t("ui.quickplay.code_sent",{destination:masked,minutes:Math.ceil(started.expires_in_seconds/60)},"Sent to {destination} · expires in {minutes} minutes."),check,
          back(phone?copy.changePhone:copy.changeEmail,()=>contact(kind,destination)),makeButton(copy.resend,()=>send(destination,channel)));
      });
    }
    form.onsubmit=e=>{e.preventDefault();send(input.value.trim(),"sms");};
    if(phone && config.phone_call_enabled) form.append(makeButton(copy.callCode,()=>{if(form.reportValidity())send(input.value.trim(),"call");}));
    show("contact",phone?copy.phone:copy.email,copy.contactHint,form,back(copy.otherMethods,methods));
    input.focus();
  }
  home();
  if(joining) (async()=>{
    const info=await apiRequest("GET",invite?"/invites/"+encodeURIComponent(invite):"/matches/"+encodeURIComponent(match));
    gameName=info.game_name || (info.game_id && (await apiRequest("GET","/games/"+encodeURIComponent(info.game_id))).name) || "";
    if(screen==="home" && gameName) translated(intro,copy.invited);
  })().catch(()=>{});
})();
