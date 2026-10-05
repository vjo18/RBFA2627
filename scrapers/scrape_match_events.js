// scrapers/scrape_match_events.js

import puppeteer from "puppeteer";
import fs from "fs";
import { spawnSync } from "child_process";

// RBFA/Akamai laat GraphQL-calls vanuit headless Chromium niet betrouwbaar toe.
// In Linux/Codespaces starten we daarom automatisch opnieuw via Xvfb en draaien
// we Chrome headful. Op andere platformen verandert dit niets.
if (
  process.platform === "linux" &&
  !process.env.DISPLAY &&
  process.env.RBFA_XVFB_CHILD !== "1"
) {
  console.log("🖥️ Geen DISPLAY gevonden. Herstart scraper via xvfb-run...");

  const result = spawnSync(
    "xvfb-run",
    ["-a", process.execPath, process.argv[1], ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: { ...process.env, RBFA_XVFB_CHILD: "1" },
    }
  );

  if (result.error) {
    console.error("❌ xvfb-run kon niet worden gestart.");
    console.error(
      "   Installeer Xvfb met: sudo apt-get update && sudo apt-get install -y xvfb"
    );
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

// ==== 1. Exacte extractie-logica uit MatchEventsv2 ====
// (lichte uitbreiding: ook 'team_against' veld)
const scriptContent = `
(() => {
  function extractMatchEvents() {
    const matchUrl = window.location.href;

    const teamNames = document.querySelectorAll('.team-info h4');
    const homeTeam = teamNames[0]?.textContent.trim() || "Home Team";
    const awayTeam = teamNames[1]?.textContent.trim() || "Away Team";

    let timelineEvents = Array.from(document.querySelectorAll('.timeline-panel-inner .item'));

    // Pre-sort timelineEvents by minute
    timelineEvents = timelineEvents.sort((a, b) => {
      const badgeA = a.closest('.timeline-panel').previousElementSibling;
      const badgeB = b.closest('.timeline-panel').previousElementSibling;
      const minuteA = badgeA?.textContent.trim().replace('‘', '') || null;
      const minuteB = badgeB?.textContent.trim().replace('‘', '') || null;
      return (parseInt(minuteA, 10) || 0) - (parseInt(minuteB, 10) || 0);
    });

    const eventData = [];
    let homeScore = 0;
    let awayScore = 0;

    const getTeamInfo = (item) => {
      const isLeft = item.closest('.timeline-panel-inner').classList.contains('left');
      return {
        team: isLeft ? homeTeam : awayTeam,
        isHome: isLeft
      };
    };

    timelineEvents.forEach((item) => {
      const { team, isHome } = getTeamInfo(item);

      let eventType = "";
      if (item.querySelector('.item-icon.goal')) {
        eventType = "Goal";
      } else if (item.querySelector('.item-icon.penalty')) {
        eventType = "Penalty";
      } else if (item.querySelector('.item-icon.yellow')) {
        eventType = "Yellow Card";
      } else if (item.querySelector('.item-icon.red')) {
        eventType = "Red Card";
      } else if (item.querySelector('.item-icon.yellowred')) {
        eventType = "Yellow-Red Card";
      } else if (item.querySelector('.item-icon.in')) {
        eventType = "Substitute In";
      } else if (item.querySelector('.item-icon.out')) {
        eventType = "Substitute Out";
      } else if (item.querySelector('.item-icon.owngoal')) {
        eventType = "Own Goal";
      }

      const firstName = item.querySelector('.name-wrapper .firstname')?.textContent.trim() || "";
      const lastName = item.querySelector('.name-wrapper .lastname')?.textContent.trim() || "";
      const playerName = \`\${firstName} \${lastName}\`.trim();

      const badge = item.closest('.timeline-panel').previousElementSibling;
      const minuteText = badge?.textContent.trim().replace('‘', '') || null;
      const minute = minuteText ? parseInt(minuteText, 10) : null;

      // Update scores dynamically
      if (eventType === "Goal" || eventType === "Penalty" || eventType === "Own Goal") {
        if (isHome) {
          homeScore++;
        } else {
          awayScore++;
        }
      }

      if (eventType) {
        const opponent = isHome ? awayTeam : homeTeam;
        eventData.push({
          matchurl: matchUrl,
          home_team: homeTeam,
          away_team: awayTeam,
          event: eventType,
          player_name: playerName,
          team: team,
          minute: minute,
          is_home: isHome ? 1 : 0,
          home_team_goals: homeScore,
          away_team_goals: awayScore,
          team_against: opponent
        });
      }
    });

    return eventData;
  }

  return extractMatchEvents();
})();
`;

// ==== 2. Helper: klein sleepje ====
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function main() {
  console.log("🚀 Starting match events scrape...");

  // ==== 3. Browser opstarten, timeouts ruim ====
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    protocolTimeout: 0, // <– voorkomt Runtime.callFunctionOn timed out
  });

  const page = await browser.newPage();
  await page.setDefaultNavigationTimeout(0); // geen navigatie-timeout
  await page.setDefaultTimeout(0); // geen generic timeout

  // ==== 4. Kalender inladen ====
  const calendarRaw = fs.readFileSync("data_raw/match_calendar.json", "utf8");
  const matches = JSON.parse(calendarRaw);

  const finishedMatches = matches.filter(
    (m) => m.homeScore !== null && m.awayScore !== null
  );

  console.log("📅 Gespeelde matchen:", finishedMatches.length);

  const outPath = "data_raw/match_events.csv";
  const currentSeasonUrls = new Set(finishedMatches.map((m) => m.url).filter(Boolean));

  // ==== 5. Alleen data van deze kalender behouden en reeds gescrapete URLs skippen ====
  const existingUrls = new Set();
  let headerWritten = false;

  if (fs.existsSync(outPath)) {
    const content = fs.readFileSync(outPath, "utf8").trim();
    if (content.length > 0) {
      const lines = content.split("\n");
      const header = lines[0].split(",");
      const urlIdx = header.indexOf("matchurl");
      if (urlIdx !== -1) {
        const currentSeasonLines = [lines[0]];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(",");
          const url = cols[urlIdx]?.replace(/^"|"$/g, "");
          if (url && currentSeasonUrls.has(url)) {
            existingUrls.add(url);
            currentSeasonLines.push(lines[i]);
          }
        }
        fs.writeFileSync(outPath, currentSeasonLines.join("\n") + "\n", "utf8");
      }
      headerWritten = true;
    }
  }

  const urlsToScrape = finishedMatches
    .map((m) => m.url)
    .filter((url) => url && !existingUrls.has(url));

  console.log("🆕 Nieuw te scrapen (events):", urlsToScrape.length);

  const CSV_HEADER = [
    "matchurl",
    "home_team",
    "away_team",
    "event",
    "player_name",
    "team",
    "minute",
    "is_home",
    "home_team_goals",
    "away_team_goals",
    "team_against",
  ];

  let index = 0;
  let successCount = 0;
  let errorCount = 0;
  let noEventsCount = 0;

  for (const url of urlsToScrape) {
    index += 1;
    console.log(`➡️ [${index}/${urlsToScrape.length}] Scraping ${url}...`);

    try {
      // zelfde strategie als in MatchEventsv2: rustig laden, geen extra fratsen
      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: 15000, // 15 seconden max
      });

      // korte pauze zodat de frontend zijn JS kan draaien
      await sleep(300);

      const eventData = await page.evaluate(scriptContent);

      if (!eventData || eventData.length === 0) {
        console.log("   ⚠️ No events found.");
        noEventsCount += 1;
        continue;
      }

      console.log(`   ✔️ ${eventData.length} events found.`);

      const rows = eventData.map((row) =>
        CSV_HEADER.map((key) => {
          const value = row[key];
          if (value === undefined || value === null) return "";
          if (typeof value === "string") {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        }).join(",")
      );

      if (!headerWritten) {
        fs.writeFileSync(outPath, CSV_HEADER.join(",") + "\n" + rows.join("\n"));
        headerWritten = true;
      } else {
        fs.appendFileSync(outPath, "\n" + rows.join("\n"));
      }

      console.log("   💾 Saved to CSV.");
      successCount += 1;

    } catch (err) {
      console.error("   ❌ Error scraping " + url + ": " + err.message);
      errorCount += 1;
    }


    // klein beetje pauze tussen matches om de site niet te hard te hameren
    await sleep(300);
  }

  console.log("✅ Match events scraping finished.");
  console.log(`   ✔️ Successful: ${successCount}/${urlsToScrape.length}`);
  console.log(`   ⚠️ No events: ${noEventsCount}`);
  console.log(`   ❌ Errors: ${errorCount}`);

  await browser.close();
}


main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
