import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";

const USERNAME = "cursinhodonaraimunda";
const POST_COUNT = 3;
const APP_ID = "936619743392459";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const FILE_PATH = path.resolve(process.cwd(), "index.html");

function request({ hostname, pathname, method = "GET", headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path: pathname,
        method,
        headers
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );

    req.on("error", reject);
    req.end();
  });
}

function extractCsrfToken(setCookieHeaders) {
  if (!Array.isArray(setCookieHeaders)) return null;

  for (const cookie of setCookieHeaders) {
    const match = /csrftoken=([^;]+)/.exec(cookie);
    if (match) return match[1];
  }

  return null;
}

async function getRecentCodes() {
  const profilePath = `/${USERNAME}/`;
  const profileResponse = await request({
    hostname: "www.instagram.com",
    pathname: profilePath,
    headers: {
      "User-Agent": USER_AGENT
    }
  });

  const csrfToken = extractCsrfToken(profileResponse.headers["set-cookie"]);
  if (!csrfToken) {
    throw new Error("Nao foi possivel obter o csrftoken do Instagram.");
  }

  const feedResponse = await request({
    hostname: "www.instagram.com",
    pathname: `/api/v1/feed/user/${USERNAME}/username/?count=12`,
    headers: {
      "User-Agent": USER_AGENT,
      "X-IG-App-ID": APP_ID,
      "X-CSRFToken": csrfToken,
      Referer: `https://www.instagram.com/${USERNAME}/`,
      Cookie: `csrftoken=${csrfToken}`
    }
  });

  if (feedResponse.statusCode !== 200) {
    throw new Error(`Instagram respondeu com status ${feedResponse.statusCode}.`);
  }

  const parsed = JSON.parse(feedResponse.body);
  const codes = (parsed.items ?? [])
    .map((item) => item?.code)
    .filter((code) => typeof code === "string");

  if (codes.length < POST_COUNT) {
    throw new Error("Nao ha posts suficientes para atualizar os embeds.");
  }

  return codes.slice(0, POST_COUNT);
}

async function updateFile(codes) {
  const embedPattern = /https:\/\/www\.instagram\.com\/p\/([A-Za-z0-9_-]+)\/embed\/captioned\//g;
  const html = await fs.readFile(FILE_PATH, "utf8");
  const oldCodes = Array.from(html.matchAll(embedPattern)).slice(0, POST_COUNT).map((m) => m[1]);

  if (oldCodes.length < POST_COUNT) {
    throw new Error(`Foram encontrados apenas ${oldCodes.length} embeds no arquivo.`);
  }

  let replaceIndex = 0;
  const updatedHtml = html.replace(embedPattern, (full) => {
    if (replaceIndex >= POST_COUNT) return full;
    const next = `https://www.instagram.com/p/${codes[replaceIndex]}/embed/captioned/`;
    replaceIndex += 1;
    return next;
  });

  await fs.writeFile(FILE_PATH, updatedHtml, "utf8");

  return { oldCodes, newCodes: codes };
}

async function main() {
  const codes = await getRecentCodes();
  const result = await updateFile(codes);

  console.log("Embeds atualizados em index.html:");
  for (let i = 0; i < POST_COUNT; i += 1) {
    console.log(`${i + 1}. ${result.oldCodes[i]} -> ${result.newCodes[i]}`);
  }
}

main().catch((error) => {
  console.error(`Falha ao atualizar embeds: ${error.message}`);
  process.exitCode = 1;
});
