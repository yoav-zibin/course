// Statistics page: numbers about users, games and matches from /admin/stats.

"use strict";

const $ = (id) => document.getElementById(id);

function card(value, label) {
  return el("div", { class: "card" }, el("div", { class: "value", textContent: value }), el("div", { class: "label", textContent: label }));
}

function cards(items) {
  return el("div", { class: "cards" }, items.map(([value, label]) => card(value, label)));
}

/** Bars for [{date, count}], oldest first. */
function barChart(title, series) {
  const max = Math.max(1, ...series.map((point) => point.count));
  const bars = series.map((point) =>
    el("div", {
      class: "bar",
      title: `${point.date}: ${point.count}`,
      style: `height: ${Math.round((point.count / max) * 100)}%`,
    }),
  );
  const total = series.reduce((sum, point) => sum + point.count, 0);
  return el(
    "div",
    { class: "panel" },
    el("h3", { textContent: `${title} (${total} in the last ${series.length} days)` }),
    el("div", { class: "bars" }, bars),
    el("div", { class: "axis" }, el("span", { textContent: series[0]?.date.slice(5) }), el("span", { textContent: series.at(-1)?.date.slice(5) })),
  );
}

function table(title, headers, rows) {
  return el(
    "div",
    { class: "panel" },
    el("h3", { textContent: title }),
    rows.length
      ? el(
          "table",
          {},
          el("thead", {}, el("tr", {}, headers.map((h, i) => el("th", { class: i ? "num" : "", textContent: h })))),
          el("tbody", {}, rows.map((row) => el("tr", {}, row.map((cell, i) => el("td", { class: i ? "num" : "", textContent: cell }))))),
        )
      : el("div", { class: "muted", textContent: "None yet." }),
  );
}

function campaignTable(title, experiment) {
  const rows = experiment.variants.map((variant) => {
    const status = el("span", { class: "muted delete-status", role: "status" });
    const remove = el("button", {
      type: "button", class: "danger", textContent: "Delete",
      "aria-label": `Delete ${variant.name}`,
      onclick: async (event) => {
        if (!window.confirm(`Delete "${variant.name}"? Its assignments and recorded experiment metrics will also be deleted.`)) return;
        const button = event.currentTarget;
        button.disabled = true;
        status.textContent = "Deleting…";
        try {
          await apiRequest("DELETE", `/admin/experiments/${encodeURIComponent(experiment.id)}/variants/${encodeURIComponent(variant.variant_id)}`);
          await refresh();
        } catch (error) {
          button.disabled = false;
          status.textContent = `Couldn't delete variant: ${error.message}`;
        }
      },
    });
    const numbers = [variant.clicks, variant.signups, variant.match_starts, variant.returning_active_users,
      variant.budget_usd == null ? "—" : `$${variant.budget_usd.toFixed(2)}`,
      `${variant.signup_rate}%`, `${variant.match_start_rate}%`, `${variant.return_rate}%`];
    return el("tr", {},
      el("td", { textContent: variant.name }),
      ...numbers.map(value => el("td", {class:"num", textContent:value})),
      el("td", {}, variant.link ? el("a", {href:variant.link, textContent:"Open", target:"_blank", rel:"noopener"}) : "—"),
      el("td", {class:"variant-actions"}, remove, status),
    );
  });
  const headings = ["Campaign", "Clicks", "Signups", "Match starts", "7-day return", "Budget", "Signup rate", "Start rate", "Return rate", "Link", "Actions"];
  return el("div", {class:"panel experiment-panel"},
    el("h3", {textContent:`${title}${experiment.active ? "" : " (paused)"}`}),
    rows.length
      ? el("div", {class:"table-scroll"}, el("table", {},
        el("thead", {}, el("tr", {}, headings.map((heading,index) => el("th", {class:index>0 && index<9 ? "num" : "", textContent:heading})))),
        el("tbody", {}, rows)))
      : el("div", {class:"muted", textContent:"No variants yet."}),
  );
}

function campaignForm() {
  const name = el("input", {required:true, maxlength:100, placeholder:"Student campaign A"});
  const key = el("input", {required:true, maxlength:50, pattern:"[a-z0-9][a-z0-9-]*", placeholder:"student-campaign-a"});
  const budget = el("input", {type:"number", min:0, max:100, step:0.01, value:100, required:true});
  const result = el("div", {class:"muted", role:"status"});
  name.addEventListener("input", () => {
    if (!key.dataset.edited) key.value = name.value.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,50);
  });
  key.addEventListener("input", () => {key.dataset.edited="true";});
  const form = el("form", {class:"experiment-form"},
    el("strong", {textContent:"Create an advertisement campaign link"}),
    el("label", {}, "Name ", name), el("label", {}, "Link key ", key),
    el("label", {}, "Budget (USD, max $100) ", budget),
    el("button", {type:"submit", textContent:"Create campaign link"}),
    el("span", {class:"muted", textContent:"Share this link to count visits and attributed activity."}), result,
  );
  form.addEventListener("submit", async event => {
    event.preventDefault();
    result.textContent="Creating…";
    try {
      const created = await apiRequest("POST", "/admin/experiments/campaign-links", {body:{name:name.value.trim(), key:key.value.trim(), budget_usd:Number(budget.value)}});
      result.replaceChildren(el("a", {href:created.url, textContent:created.url, target:"_blank", rel:"noopener"}));
      key.value="";name.value="";key.dataset.edited="";
      await refresh();
    } catch (error) {result.textContent=`Couldn't create variant: ${error.message}`;}
  });
  return form;
}

function experimentManagement() {
  return el("div", {class:"experiment-manager"}, el("section", {class:"experiment-manager-item"},
    campaignForm(),
    el("details", {class:"experiment-help"}, el("summary", {textContent:"Step-by-step: create and use a campaign link"}),
      el("ol", {}, [
        "Enter a name that will help you recognize this campaign in the results.",
        "Choose a unique link key. The form suggests one from the name; use lowercase letters, numbers, and hyphens only.",
        "Click Create campaign link. The new link appears in the campaign results above.",
        "Copy the generated link using Open (or right-click it and choose Copy link). Share this exact link in the campaign you want to measure. Create a separate link for each campaign.",
        "Return to this page to compare clicks, attributed signups, match starts, and 7-day returns. A signup is attributed when someone creates an account after visiting the link.",
      ].map(text => el("li", {textContent:text})))),
  ));
}

function gamesPanel(games) {
  const rows = games.map((g) =>
    el(
      "tr",
      {},
      el("td", { textContent: g.deleted ? `${g.name} (deleted)` : g.name }),
      el("td", { class: "num", textContent: g.versions }),
      el("td", { class: "num", textContent: g.matches }),
    ),
  );
  return el(
    "div",
    { class: "panel" },
    el("h3", { textContent: "Matches by game" }),
    games.length
      ? el(
          "table",
          {},
          el(
            "thead",
            {},
            el(
              "tr",
              {},
              ["Game", "Versions", "Matches"].map((h, i) =>
                el("th", { class: i > 0 ? "num" : "", textContent: h }),
              ),
            ),
          ),
          el("tbody", {}, rows),
        )
      : el("div", { class: "muted", textContent: "None yet." }),
  );
}

function render(stats, experiments) {
  const { users, games, matches } = stats;
  $("content").replaceChildren(
    el("h2", { textContent: "Portal: users and matches" }),
    cards([
      [users.total, "users"],
      [users.who_played_a_match, "users who played a match"],
      [users.guests_only, "guest-only users"],
      [users.with_google, "linked to Google"],
      [users.with_email, "linked to email"],
      [matches.total, "matches"],
      [matches.by_status.waiting_for_players, "waiting for players"],
      [matches.by_status.ongoing, "ongoing"],
      [matches.by_status.over, "over"],
      [matches.total_moves, "moves made"],
      [matches.avg_moves_per_match, "moves per match"],
      [matches.ended_because_a_player_left, "ended by a player leaving"],
    ]),
    el(
      "div",
      { class: "panels" },
      barChart("New users per day", users.new_per_day),
      barChart("New matches per day", matches.new_per_day),
      table("Users by language", ["Language", "Users"], Object.entries(users.by_locale ?? {})),
    ),
    el("h2", { textContent: "Games" }),
    cards([
      [games.live, "live games"],
      [games.deleted, "deleted games"],
      [games.versions, "versions saved"],
    ]),
    el(
      "div",
      { class: "panels" },
      barChart("New games per day", games.new_per_day),
      gamesPanel(games.per_game),
    ),
    el("h2", { textContent: "Advertisement campaigns" }),
    el(
      "p",
      { class: "muted", textContent: "Returning active users are signups that started a match during days 7–14 after signup." },
    ),
    el(
      "div",
      { class: "panels experiment-results" },
      campaignTable("Advertisement campaigns", experiments.campaign_experiment),
    ),
    experimentManagement(),
  );
}

async function refresh() {
  try {
    const [statsResponse, experimentsResponse] = await Promise.all([
      fetch("/admin/stats"),
      fetch("/admin/experiments"),
    ]);
    if (!statsResponse.ok) throw new Error(`GET /admin/stats: ${statsResponse.status}`);
    const [stats, experiments] = await Promise.all([
      statsResponse.json(),
      experimentsResponse.ok ? experimentsResponse.json() : Promise.resolve(null),
    ]);
    $("error").textContent = "";
    if (stats.schema_version === 2) {
      const rows=Object.entries(stats.counts).sort(([a],[b])=>a.localeCompare(b));
      $("content").replaceChildren(table("Database records",["Record type","Count"],rows));
      if (stats.snapshot) {
        const snapshot = stats.snapshot;
        const anchor = new Date(`${snapshot.anchor}T00:00:00Z`);
        const dates = Array.from({length:30}, (_, i) => {
          const date = new Date(anchor);
          date.setUTCDate(date.getUTCDate() - 29 + i);
          return date.toISOString().slice(0,10);
        });
        $("content").append(
          el("p", {textContent:`Historical report built ${formatTime(snapshot.generated_at)}`}),
          ...["users", "games", "matches"].map(kind => barChart(
            `New ${kind} per day`, dates.map(date => ({date, count:snapshot.days[date]?.[kind] ?? 0}))
          )),
        );
      }
      if (experiments) $("content").append(
        el("p", {textContent:`Experiment report built ${formatTime(experiments.generated_at)}`}),
          campaignTable("Advertisement campaigns", experiments.campaign_experiment),
        experimentManagement(),
      );
      else $("content").append(el("p", {textContent:"Experiment report is currently unavailable."}));
    } else {
      if (!experiments) throw new Error(`GET /admin/experiments: ${experimentsResponse.status}`);
      render(stats, experiments);
    }
    $("freshness").textContent = I18n.t("ui.admin.loaded", { time: formatTime(stats.generated_at) }, "Loaded {time}");
  } catch (error) {
    $("error").textContent = I18n.t("ui.admin.stats_load_failed", { message: error.message }, "Couldn't load statistics: {message}");
  }
}

$("refresh").addEventListener("click", refresh);
refresh();
