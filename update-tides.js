const fs = require("fs");

const LOCATIONS = [
  {
    name: "Montego Bay",
    url: "https://tidecheck.com/tides/montego-bay"
  },
  {
    name: "Falmouth",
    url: "https://tidecheck.com/tides/falmouth"
  },
  {
    name: "Ocho Rios",
    url: "https://tidecheck.com/tides/ocho-rios"
  },
  {
    name: "Negril",
    url: "https://tidecheck.com/tides/negril"
  },
  {
    name: "Kingston",
    url: "https://tidecheck.com/tides/kingston-kingston"
  },
  {
    name: "Port Antonio",
    url: "https://tidecheck.com/tides/port-antonio"
  }
];

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTime(time) {
  const match = time.match(
    /(\d{1,2}):(\d{2})\s*(AM|PM)/i
  );

  if (!match) return null;

  return (
    match[1].padStart(2, "0") +
    ":" +
    match[2] +
    " " +
    match[3].toUpperCase()
  );
}

function timeToMinutes(time) {
  const match = time.match(
    /(\d{1,2}):(\d{2})\s*(AM|PM)/i
  );

  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3].toUpperCase();

  if (period === "AM" && hour === 12) hour = 0;
  if (period === "PM" && hour !== 12) hour += 12;

  return hour * 60 + minute;
}

function jamaicaNowMinutes() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Jamaica",
    hour: "numeric",
    minute: "numeric",
    hour12: false
  }).formatToParts(new Date());

  const hour = Number(
    parts.find(p => p.type === "hour").value
  );

  const minute = Number(
    parts.find(p => p.type === "minute").value
  );

  return hour * 60 + minute;
}

function extractTides(text) {
  const regex =
    /(High|Low)\s+Tide\s+(\d{1,2}:\d{2}\s*(?:AM|PM))\s+(-?\d+(?:\.\d+)?)m\s+\((-?\d+(?:\.\d+)?)ft\)/gi;

  const tides = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    tides.push({
      type: match[1].toLowerCase(),
      time: normalizeTime(match[2]),
      metres: Number(match[3]),
      feet: Number(match[4])
    });
  }

  return tides;
}

function removeDuplicates(tides) {
  const seen = new Set();

  return tides.filter(tide => {
    const key =
      tide.type + "|" + tide.time + "|" + tide.feet;

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function findNext(tides, type, nowMinutes) {
  const matching = tides.filter(
    tide => tide.type === type
  );

  const futureToday = matching.find(tide => {
    const mins = timeToMinutes(tide.time);
    return mins !== null && mins >= nowMinutes;
  });

  if (futureToday) {
    return futureToday;
  }

  /*
    If today's tide of this type has already passed,
    TideCheck normally includes tomorrow's tides later
    in the page. Return the next occurrence.
  */

  return matching[0] || null;
}

async function fetchLocation(location) {
  console.log(`Fetching ${location.name}...`);

  const response = await fetch(location.url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; JamaicaTideCenter/1.0)"
    }
  });

  if (!response.ok) {
    throw new Error(
      `${location.name}: HTTP ${response.status}`
    );
  }

  const html = await response.text();
  const text = cleanText(html);

  if (
    !text.toLowerCase().includes("jamaica")
  ) {
    throw new Error(
      `${location.name}: page did not identify Jamaica`
    );
  }

  let tides = extractTides(text);
  tides = removeDuplicates(tides);

  if (tides.length === 0) {
    throw new Error(
      `${location.name}: no tide predictions found`
    );
  }

  const nowMinutes = jamaicaNowMinutes();

  const high = findNext(
    tides,
    "high",
    nowMinutes
  );

  const low = findNext(
    tides,
    "low",
    nowMinutes
  );

  if (!high || !low) {
    throw new Error(
      `${location.name}: could not find both high and low tide`
    );
  }

  return {
    name: location.name,

    high: {
      time: high.time,
      height: high.feet.toFixed(1)
    },

    low: {
      time: low.time,
      height: low.feet.toFixed(1)
    }
  };
}

async function main() {
  const results = [];

  for (const location of LOCATIONS) {
    try {
      const result =
        await fetchLocation(location);

      results.push(result);

      console.log(
        `${location.name}: HIGH ${result.high.time} ${result.high.height} ft | LOW ${result.low.time} ${result.low.height} ft`
      );

    } catch (error) {
      console.error(error.message);

      results.push({
        name: location.name,

        high: {
          time: "--:--",
          height: "--"
        },

        low: {
          time: "--:--",
          height: "--"
        }
      });
    }
  }

  const updated = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: "America/Jamaica",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }
  ).format(new Date());

  const output = {
    updated:
      updated + " Jamaica time",
    source:
      "TideCheck / FES2022 / TICON-4",
    datum:
      "LAT",
    locations: results
  };

  fs.writeFileSync(
    "tide-data.json",
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log(
    "\ntide-data.json updated successfully."
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
