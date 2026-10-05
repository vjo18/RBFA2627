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
    page.on("console", (message) => console.log(message.text()));

    console.log(`📅 Calendar: ${CALENDAR_URL}`);
    const response = await page.goto(CALENDAR_URL, {
      waitUntil: "networkidle0",
      timeout: 120_000,
    });
    if (!response?.ok()) {
      throw new Error(`RBFA calendar returned HTTP ${response?.status()}`);
    }

    // The select exists before Angular has populated its 52 round options.
    // Starting page.evaluate() at that point produces an empty calendar. Wait
    // for the populated select, then allow the initial view to settle.
    await page.waitForFunction(
      () =>
        Math.max(
          0,
          ...Array.from(
            document.querySelectorAll("select"),
            (select) => select.options.length,
          ),
        ) >= 10,
      { timeout: 30_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 3000));

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

      // There are multiple selects on the page. The calendar select is the one
      // with by far the most options (52 in the current competition).
      const dropdown = Array.from(document.querySelectorAll("select")).sort(
        (a, b) => b.options.length - a.options.length,
      )[0];
      if (!dropdown) {
        return [];
      }

      const options = Array.from(dropdown.options);

      for (let i = 0; i < options.length; i++) {
        console.log(`➡️ Loading speeldag ${i + 1}/${options.length}...`);
        dropdown.selectedIndex = i;
        dropdown.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(3000);
        extractMatchData();
        console.log(
          `   ✔️ Speeldag ${i + 1} klaar, totaal: ${matchData.length} matchen`,
        );
      }

      return matchData;
    });

    if (matchData.length === 0) {
      throw new Error(
        "RBFA calendar scrape returned 0 matches; the existing calendar was left untouched.",
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
