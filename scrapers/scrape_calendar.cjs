const fs = require("fs");
const { spawnSync } = require("child_process");
const puppeteer = require("puppeteer");

const CALENDAR_URL =
  process.env.RBFA_CALENDAR_URL ||
  "https://www.rbfa.be/nl/competitie/CHP_136334/kalender";

// RBFA/Akamai laat de kalender-GraphQL-calls momenteel niet betrouwbaar toe
// vanuit headless Chromium. In Linux/Codespaces starten we daarom automatisch
// opnieuw via Xvfb en draaien we Chrome headful.
if (!process.env.DISPLAY && process.env.RBFA_XVFB_CHILD !== "1") {
  console.log("🖥️ Geen DISPLAY gevonden. Herstart scraper via xvfb-run...");

  const result = spawnSync(
    "xvfb-run",
    ["-a", process.execPath, __filename, ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        RBFA_XVFB_CHILD: "1",
      },
    }
  );

  if (result.error) {
    console.error("❌ xvfb-run kon niet worden gestart.");
    console.error("   Installeer Xvfb met: sudo apt-get update && sudo apt-get install -y xvfb");
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

(async () => {
  console.log("🚀 Starting calendar scrape...");

  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60000);

  console.log(`📅 Calendar: ${CALENDAR_URL}`);
  await page.goto(CALENDAR_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // Wacht expliciet tot de RBFA kalendercomponent geladen is.
  // Als GraphQL opnieuw geblokkeerd wordt, krijgen we hier een duidelijke fout
  // in plaats van stilletjes een lege match_calendar.json te schrijven.
  await page.waitForSelector("select", { timeout: 30000 });

  const matchData = await page.evaluate(async () => {
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
            ".team:first-child .team-name"
          );
          const awayTeamElement = element.querySelector(
            ".team.reverse .team-name"
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

    const dropdown = document.querySelector("select");
    if (!dropdown) {
      return [];
    }

    const options = Array.from(dropdown.options);

    for (let i = 0; i < options.length; i++) {
      console.log(`➡️ Loading speeldag ${i + 1}/${options.length}...`);
      dropdown.selectedIndex = i;
      dropdown.dispatchEvent(new Event("change"));
      await sleep(2000);
      extractMatchData();
      console.log(
        `   ✔️ Speeldag ${i + 1} klaar, totaal: ${matchData.length} matchen`
      );
    }

    return matchData;
  });

  await browser.close();

  if (!Array.isArray(matchData) || matchData.length === 0) {
    throw new Error(
      "Kalenderscrape leverde 0 wedstrijden op. Bestaande match_calendar.json blijft onaangeroerd."
    );
  }

  fs.writeFileSync(
    "data_raw/match_calendar.json",
    JSON.stringify(matchData, null, 2),
    "utf8"
  );

  console.log("💾 File saved: data_raw/match_calendar.json");
  console.log(`📊 Total matches scraped: ${matchData.length}`);
  console.log("✅ Calendar scraping complete.");
})();
