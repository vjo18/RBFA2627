const fs = require("fs");
const puppeteer = require("puppeteer");

const CALENDAR_URL =
  process.env.RBFA_CALENDAR_URL ||
  "https://www.rbfa.be/nl/competitie/CHP_136334/kalender";

(async () => {
  console.log("🚀 Starting calendar scrape...");

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    console.log(`📅 Calendar: ${CALENDAR_URL}`);
    const response = await page.goto(CALENDAR_URL, {
      waitUntil: "networkidle0",
      timeout: 120_000,
    });

    if (!response?.ok()) {
      throw new Error(
        `RBFA calendar returned HTTP ${response?.status() ?? "unknown"}`,
      );
    }

    // The calendar is rendered client-side. Give it a chance to appear instead
    // of interpreting a not-yet-rendered page as an empty competition.
    await page
      .waitForSelector(".game-item, select", { timeout: 15_000 })
      .catch(() => undefined);

    const scrapeResult = await page.evaluate(async () => {
      const matchData = [];
      let currentDate = null;
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      function extractMatchData() {
        const elements = document.querySelectorAll(".game-item, .date");

        elements.forEach((element) => {
          if (element.classList.contains("date")) {
            currentDate = element.innerText.trim();
          } else if (element.classList.contains("game-item")) {
            const homeTeamElement = element.querySelector(
              ".team:first-child .team-name",
            );
            const awayTeamElement = element.querySelector(
              ".team.reverse .team-name",
            );
            const scoreElement = element.querySelector(".score");
            const matchLinkElement = element.querySelector(".team-score");
            const matchLink =
              matchLinkElement?.href || matchLinkElement?.parentNode?.href;

            const homeTeam = homeTeamElement?.innerText.trim() || null;
            const awayTeam = awayTeamElement?.innerText.trim() || null;
            const score = scoreElement?.innerText.trim() || null;

            let homeScore = null;
            let awayScore = null;
            if (score && score.includes("-")) {
              [homeScore, awayScore] = score.split("-").map((s) => s.trim());
            }

            const url = matchLink
              ? matchLink.startsWith("http")
                ? matchLink
                : window.location.origin + matchLink
              : null;

            if (homeTeam && awayTeam && url && currentDate) {
              matchData.push({
                url,
                date: currentDate,
                homeTeam,
                homeScore,
                awayTeam,
                awayScore,
              });
            }
          }
        });
      }

      const dropdown = Array.from(document.querySelectorAll("select")).find(
        (select) => select.options.length > 1,
      );
      if (!dropdown) {
        // RBFA no longer always renders a matchday dropdown. On the new
        // calendar page all fixtures can already be present in the DOM.
        extractMatchData();
        return {
          matches: matchData,
          reason:
            matchData.length === 0
              ? "no matches or matchday selector were found"
              : null,
        };
      }

      const options = Array.from(dropdown.options);

      for (let i = 0; i < options.length; i++) {
        console.log(`➡️ Loading speeldag ${i + 1}/${options.length}...`);
        // Framework-driven pages can replace the select after every change, so
        // obtain the live element again rather than retaining a detached node.
        const liveDropdown = Array.from(
          document.querySelectorAll("select"),
        ).find((select) => select.options.length === options.length);
        if (!liveDropdown) {
          return {
            matches: [],
            reason:
              "the matchday selector disappeared while loading the calendar",
          };
        }
        liveDropdown.selectedIndex = i;
        liveDropdown.dispatchEvent(new Event("input", { bubbles: true }));
        liveDropdown.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(2000);
        extractMatchData();
        console.log(
          `   ✔️ Speeldag ${i + 1} klaar, totaal: ${matchData.length} matchen`,
        );
      }

      return { matches: matchData, reason: null };
    });

    const matchData = scrapeResult.matches;

    if (matchData.length === 0) {
      throw new Error(
        `RBFA calendar scrape returned 0 matches (${scrapeResult.reason || "the page structure may have changed"}). ` +
          "The existing data_raw/match_calendar.json was left untouched.",
      );
    }

    fs.writeFileSync(
      "data_raw/match_calendar.json",
      JSON.stringify(matchData, null, 2),
      "utf8",
    );

    console.log("💾 File saved: data_raw/match_calendar.json");
    console.log(`📊 Total matches scraped: ${matchData.length}`);
    console.log("✅ Calendar scraping complete.");
  } finally {
    await browser.close();
  }
})();
