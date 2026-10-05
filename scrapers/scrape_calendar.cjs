const fs = require("fs");
const puppeteer = require("puppeteer");

const CALENDAR_URL =
  process.env.RBFA_CALENDAR_URL ||
  "https://www.rbfa.be/nl/competitie/CHP_136334/kalender";
const CALENDAR_PATH = "data_raw/match_calendar.json";

const DUTCH_MONTHS = {
  januari: 0,
  februari: 1,
  maart: 2,
  april: 3,
  mei: 4,
  juni: 5,
  juli: 6,
  augustus: 7,
  september: 8,
  oktober: 9,
  november: 10,
  december: 11,
};

function parseDutchDate(value) {
  const match = value
    ?.toLowerCase()
    .match(/(?:[^,]+,\s*)?(\d{1,2})\s+(\p{L}+)\s+(\d{4})/u);
  if (!match || DUTCH_MONTHS[match[2]] === undefined) return null;
  return new Date(Number(match[3]), DUTCH_MONTHS[match[2]], Number(match[1]));
}

async function refreshScoresFromMatchPages(page) {
  if (!fs.existsSync(CALENDAR_PATH)) return [];

  const matches = JSON.parse(fs.readFileSync(CALENDAR_PATH, "utf8"));
  if (!Array.isArray(matches) || matches.length === 0) return [];

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const candidates = matches.filter((match) => {
    const date = parseDutchDate(match.date);
    return (
      match.url &&
      (match.homeScore === null || match.awayScore === null) &&
      date &&
      date <= tomorrow
    );
  });

  console.log(
    `↪️ Calendar overview unavailable; checking ${candidates.length} recent match pages...`,
  );

  let updated = 0;
  for (const match of candidates) {
    try {
      await page.goto(match.url, {
        waitUntil: "networkidle2",
        timeout: 30_000,
      });
      const score = await page.evaluate(() => {
        const text = document
          .querySelector(".event-summery-info .score")
          ?.textContent?.trim();
        const parts = text?.match(/^(\d+)\s*-\s*(\d+)$/);
        return parts ? [parts[1], parts[2]] : null;
      });
      if (score) {
        [match.homeScore, match.awayScore] = score;
        updated += 1;
      }
    } catch (error) {
      console.warn(`⚠️ Could not update ${match.url}: ${error.message}`);
    }
  }

  console.log(`   ✔️ Scores updated from match pages: ${updated}`);
  return matches;
}

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

    const scrapeFrame = (frame) =>
      frame.evaluate(async () => {
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

    // The renewed RBFA site can mount the match centre in an iframe. Puppeteer
    // does not include iframe DOM nodes in page.evaluate(), even when that
    // frame is visible on screen, so inspect every attached frame explicitly.
    const frameResults = [];
    for (const frame of page.frames()) {
      try {
        frameResults.push(await scrapeFrame(frame));
      } catch (error) {
        console.warn(
          `⚠️ Could not inspect frame ${frame.url() || "(no URL)"}: ${error.message}`,
        );
      }
    }

    const matchesByUrl = new Map();
    for (const result of frameResults) {
      for (const match of result.matches) {
        matchesByUrl.set(match.url, match);
      }
    }

    const scrapeResult = {
      matches: [...matchesByUrl.values()],
      reason: frameResults
        .map((result) => result.reason)
        .filter(Boolean)
        .join("; "),
    };

    if (scrapeResult.matches.length === 0) {
      scrapeResult.matches = await refreshScoresFromMatchPages(page);
      if (scrapeResult.matches.length > 0) {
        scrapeResult.reason = null;
      }
    }

    const matchData = scrapeResult.matches;

    if (matchData.length === 0) {
      throw new Error(
        `RBFA calendar scrape returned 0 matches (${scrapeResult.reason || "the page structure may have changed"}). ` +
          "The existing data_raw/match_calendar.json was left untouched.",
      );
    }

    fs.writeFileSync(CALENDAR_PATH, JSON.stringify(matchData, null, 2), "utf8");

    console.log("💾 File saved: data_raw/match_calendar.json");
    console.log(`📊 Total matches scraped: ${matchData.length}`);
    console.log("✅ Calendar scraping complete.");
  } finally {
    await browser.close();
  }
})();
