// Loaded only when the visitor chooses ?login=quick-play. No saved preference.
"use strict";
(() => {
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
    options.inert = true; options.setAttribute("aria-busy","true"); status.textContent = "Please wait…";
    try { await fn(); }
    catch (error) { if (stamp === revision) status.textContent = error.message || "Please try again."; }
    finally { controls.forEach(control => control.disabled = false); options.inert = false; options.removeAttribute("aria-busy"); }
  }
  const guest = () => submit(async () => Auth.upsert(await Auth.createGuest()));
  function home() {
    const play = makeButton("Play as a guest", guest, joining);
    const sign = makeButton("Sign in to an existing account", methods, !joining);
    const help = el("small", {}, "Start now. Link a sign-in method later.");
    show("home", joining ? "Join this match" : "Sign in to BuildPlay",
      gameName ? "You’re invited to play " + gameName + "." : joining ? "Choose how to join the match." : "Pick up where you left off, or start a game as a guest.",
      ...(joining ? [play,help,sign] : [sign,play,help]));
  }
  async function methods() {
    show("methods","Sign in to BuildPlay","Choose a sign-in method.",back("Back",home));
    const stamp = revision;
    try {
      config = await apiRequest("GET","/auth/config");
      if (stamp !== revision) return;
      const buttons = [];
      if (config.google_client_id) buttons.push(makeButton("Continue with Google",google));
      if (config.email_login_enabled) buttons.push(makeButton("Continue with email",()=>contact("email")));
      if (config.phone_login_enabled) buttons.push(makeButton("Continue with phone",()=>contact("phone")));
      options.prepend(...buttons);
      if (!buttons.length) status.textContent="No sign-in methods are available. You can still play as a guest.";
    } catch { if (stamp===revision) options.prepend(makeButton("Retry sign-in options",methods)); }
  }
  async function google() {
    const holder=el("div");
    show("google","Continue with Google","Choose your Google account.",holder,back("Other sign-in methods",methods));
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
    } catch { if(stamp===revision) status.textContent="Google sign-in could not load. Try another method."; }
  }
  function contact(kind,value="") {
    const phone=kind==="phone", field=phone?"phone_number":"email", path="/auth/"+kind;
    const input=el("input",{type:phone?"tel":"email",autocomplete:phone?"tel":"email",value,required:true,placeholder:phone?"+15551234567":"you@example.com"});
    const form=el("form",{},el("label",{},phone?"Phone number":"Email address",input),
      el("button",{type:"submit",class:"primary",textContent:phone?"Text me a code":"Email me a code"}));
    function send(destination,channel) {
      return submit(async()=>{
        const started=await apiRequest("POST",path+"/start",{body:{[field]:destination,...(phone?{delivery_method:channel}:{})}});
        const masked=phone?"•••• "+destination.slice(-4):destination.replace(/^(.).*?@/,"$1•••@");
        const code=el("input",{type:"text",inputMode:"numeric",autocomplete:"one-time-code",pattern:"[0-9]{6}",maxLength:6,required:true});
        const check=el("form",{},el("label",{},"6-digit code",code),el("button",{type:"submit",class:"primary",textContent:joining?"Verify and join":"Verify and sign in"}));
        check.onsubmit=e=>{e.preventDefault();submit(async()=>Auth.upsert(await apiRequest("POST",path+"/verify",{body:Auth.newAccountBody({verification_id:started.verification_id,code:code.value})})));};
        show("verify","Enter your code","Sent to "+masked+" · expires in "+Math.ceil(started.expires_in_seconds/60)+" minutes.",check,
          back(phone?"Change number":"Change email",()=>contact(kind,destination)),makeButton("Send another code",()=>send(destination,channel)));
        queueMicrotask(()=>code.focus());
      });
    }
    form.onsubmit=e=>{e.preventDefault();send(input.value.trim(),"sms");};
    if(phone && config.phone_call_enabled) form.append(makeButton("Call me with a code",()=>{if(form.reportValidity())send(input.value.trim(),"call");}));
    show("contact",phone?"Continue with phone":"Continue with email","We’ll send you a verification code.",form,back("Other sign-in methods",methods));
    input.focus();
  }
  home();
  if(joining) (async()=>{
    const info=await apiRequest("GET",invite?"/invites/"+encodeURIComponent(invite):"/matches/"+encodeURIComponent(match));
    gameName=info.game_name || (info.game_id && (await apiRequest("GET","/games/"+encodeURIComponent(info.game_id))).name) || "";
    if(screen==="home" && gameName) intro.textContent="You’re invited to play "+gameName+".";
  })().catch(()=>{});
})();
