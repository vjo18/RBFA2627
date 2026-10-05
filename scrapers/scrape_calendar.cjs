const fs = require("fs");
const puppeteer = require("puppeteer");

const CALENDAR_URL =
  process.env.RBFA_CALENDAR_URL ||
  "https://www.rbfa.be/nl/competitie/CHP_136334/kalender";
const OUTPUT_FILE = "data_raw/match_calendar.json";

(async () => {
  console.log("🚀 Starting calendar scrape...");

  let browser;

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    console.log(`📅 Calendar: ${CALENDAR_URL}`);
    await page.goto(CALENDAR_URL, {
      waitUntil: "networkidle2",
      timeout: 60_000,
    });
    await page.waitForSelector("select", { timeout: 30_000 });

    const matchData = await page.evaluate(async () => {
      const matchesByUrl = new Map();
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      function calendarSignature() {
        return Array.from(document.querySelectorAll(".game-item, .date"))
          .map((element) => element.textContent.trim())
          .join("|");
      }

      async function waitForCalendarUpdate(previousSignature) {
        const timeoutAt = Date.now() + 5_000;
        let signature = calendarSignature();
        let stableChecks = 0;

        // Angular updates the calendar asynchronously. Waiting for a fixed two
        // seconds can read the previous week on a slow response. Instead, wait
        // until the calendar has changed and then remained stable briefly.
        while (Date.now() < timeoutAt) {
          await sleep(200);
          const nextSignature = calendarSignature();

          if (nextSignature !== previousSignature && nextSignature === signature) {
            stableChecks += 1;
            if (stableChecks >= 2) return;
          } else {
            stableChecks = 0;
          }

          signature = nextSignature;
        }

        // Empty weeks can legitimately have the same (empty) signature.
        console.warn("Kalenderwijziging niet gedetecteerd; huidige inhoud wordt gebruikt.");
      }

      function extractMatchData() {
        let currentDate = null;
        const elements = document.querySelectorAll(".game-item, .date");

        elements.forEach((element) => {
          if (element.classList.contains("date")) {
            currentDate = element.textContent.trim();
            return;
          }

          const homeTeam =
            element.querySelector(".team:first-child .team-name")?.textContent.trim() ||
            null;
          const awayTeam =
            element.querySelector(".team.reverse .team-name")?.textContent.trim() ||
            null;
          const score = element.querySelector(".score")?.textContent.trim() || null;
          const matchLinkElement = element.querySelector(".team-score");
          const matchLink =
            matchLinkElement?.href || matchLinkElement?.closest("a")?.href;

          let homeScore = null;
          let awayScore = null;
          const scoreMatch = score?.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
          if (scoreMatch) {
            [, homeScore, awayScore] = scoreMatch;
          }

          const url = matchLink ? new URL(matchLink, window.location.origin).href : null;

          if (homeTeam && awayTeam && url && currentDate) {
            matchesByUrl.set(url, {
              url,
              date: currentDate,
              homeTeam,
              homeScore,
              awayTeam,
              awayScore,
            });
          }
        });

        return elements.length;
      }

      // The page contains other selects (for filters). The week selector has a
      // large option list; selecting the first arbitrary <select> is brittle.
      const dropdown = Array.from(document.querySelectorAll("select")).find(
        (select) => select.options.length >= 20
      );
      if (!dropdown) {
        throw new Error("Keuzelijst met kalenderweken niet gevonden.");
      }

      const optionValues = Array.from(dropdown.options, (option) => option.value);

      for (let i = 0; i < optionValues.length; i += 1) {
        const previousSignature = calendarSignature();
        dropdown.value = optionValues[i];
        dropdown.dispatchEvent(new Event("change", { bubbles: true }));
        await waitForCalendarUpdate(previousSignature);

        const elementCount = extractMatchData();
        console.log(
          `Speeldag ${i + 1}/${optionValues.length}: ${elementCount} elementen, ` +
            `${matchesByUrl.size} unieke matchen in totaal`
        );
      }

      return Array.from(matchesByUrl.values());
    });

    if (matchData.length === 0) {
      throw new Error(
        "Geen wedstrijden gevonden; bestaand kalenderbestand is niet overschreven."
      );
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(matchData, null, 2), "utf8");

    console.log(`💾 File saved: ${OUTPUT_FILE}`);
    console.log(`📊 Total unique matches scraped: ${matchData.length}`);
    console.log("✅ Calendar scraping complete.");
  } catch (error) {
    console.error("❌ Calendar scraping failed:", error.message);
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
})();
