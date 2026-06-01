import { connect } from "framer-api"
import { readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"

const PROJECT_URL = "https://framer.com/projects/CpOBrSHMchxEpTjLh4be"
const COMPONENT_NAME = "FinalSparkLiveViz.tsx"
const COMPONENT_PATH = new URL("../framer/FinalSparkLiveViz.tsx", import.meta.url)
const REPLAY_PATH = new URL("../data/replay-sample.json", import.meta.url)
const TOKEN_PATH = new URL("../codexframer.rtf", import.meta.url)
const SITE_TITLE = "FinalSpark Live Activity Dashboard"
const SITE_DESCRIPTION =
  "Public LiveMEA windows with crossings, heatmaps, timeline, and electrode mapping."
const DEFAULT_HEADLESS_SERVER_URL = "wss://api.framer.com/channel/headless-plugin"
const PREFLIGHT_TIMEOUT_MS = 10_000

const PRIMARY_TARGET = { name: "Desktop", parentId: "KyMiQ733k", height: "fit-content" }
const REPLICA_TARGETS = [
  { name: "Tablet", parentId: "vHakaUxOYKyMiQ733k" },
  { name: "Phone", parentId: "smYYsX1iwKyMiQ733k" },
]

const shouldPublish = process.argv.includes("--publish")
const siteCodeOnly = process.argv.includes("--site-code-only")

async function main() {
  const token = await readToken()
  const connectionOptions = getConnectionOptions()

  await assertFramerHeadlessReachable(connectionOptions?.serverUrl ?? DEFAULT_HEADLESS_SERVER_URL)

  let framer
  try {
    framer = await connect(PROJECT_URL, token, connectionOptions)
    const project = await framer.getProjectInfo()
    console.log(`Connected to ${project.name}`)

    if (siteCodeOnly) {
      await upsertSiteMetadata(framer)
      const changed = await framer.getChangedPaths()
      console.log(`Changed paths: ${JSON.stringify(changed)}`)
      await publishIfRequested(framer)
      return
    }

    const source = await readFile(COMPONENT_PATH, "utf8")
    const replayBytes = await readFile(REPLAY_PATH)

    const diagnostics = await framer.typecheckCode(COMPONENT_NAME, source, {
      strict: false,
      jsx: "react-jsx",
      moduleResolution: "bundler",
    })
    if (diagnostics.length > 0) {
      console.error(formatDiagnostics(diagnostics))
      process.exitCode = 1
      return
    }
    console.log("Framer typecheck: 0 diagnostics")

    const codeFile = await upsertCodeFile(framer, source)
    const componentExport = codeFile.exports.find((item) => item.type === "component")
    if (!componentExport?.insertURL) {
      throw new Error(`${COMPONENT_NAME} did not expose an insertable component export`)
    }
    console.log(`Code file ready: ${codeFile.name}`)

    const replayAsset = await framer.uploadFile({
      name: "finalspark-replay-sample.json",
      file: {
        bytes: new Uint8Array(replayBytes),
        mimeType: "application/json",
      },
    })
    console.log(`Replay asset uploaded: ${replayAsset.url}`)

    await upsertPrimaryInstance(framer, componentExport.insertURL, replayAsset)
    await verifyReplicaInstances(framer)
    await rebrandTemplate(framer)
    await upsertPageMetadata(framer)
    await upsertSiteMetadata(framer)
    const changed = await framer.getChangedPaths()
    console.log(`Changed paths: ${JSON.stringify(changed)}`)

    await publishIfRequested(framer)
  } finally {
    if (framer) await framer.disconnect()
  }
}

async function publishIfRequested(framer) {
  if (shouldPublish) {
    const publish = await framer.publish()
    console.log(`Publish: ${JSON.stringify(publish)}`)
  } else {
    console.log("Publish skipped. Re-run with --publish after inspection.")
  }
}

function getConnectionOptions() {
  const serverUrl = process.env.FRAMER_HEADLESS_SERVER_URL?.trim()
  return serverUrl ? { serverUrl } : undefined
}

async function assertFramerHeadlessReachable(serverUrl) {
  const probeUrl = toHttpProbeUrl(serverUrl)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS)

  let response
  let body = ""
  try {
    response = await fetch(probeUrl, {
      headers: { accept: "application/json,text/plain,*/*" },
      signal: controller.signal,
    })
    body = await response.text().catch(() => "")
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        `Timed out checking Framer headless API at ${probeUrl}. Publishing needs this endpoint before it can update the Framer project.`
      )
    }
    throw new Error(
      `Cannot reach Framer headless API at ${probeUrl}: ${error instanceof Error ? error.message : String(error)}`
    )
  } finally {
    clearTimeout(timeout)
  }

  if (response.status === 451 || isCloudFrontCountryBlock(response, body)) {
    throw new Error(
      [
        `Framer headless API is blocked from this network: HTTP ${response.status}.`,
        body ? `Response: ${summarizeBody(body)}` : null,
        "The local Framer component is ready, but publishing cannot continue until api.framer.com is reachable.",
        "Run this command from a network where Framer is not blocked, or set FRAMER_HEADLESS_SERVER_URL to a Framer-provided reachable endpoint.",
      ]
        .filter(Boolean)
        .join("\n")
    )
  }
}

function toHttpProbeUrl(serverUrl) {
  const url = new URL(serverUrl)
  if (url.protocol === "wss:") url.protocol = "https:"
  if (url.protocol === "ws:") url.protocol = "http:"
  return url.toString()
}

function isCloudFrontCountryBlock(response, body) {
  const server = response.headers.get("server") ?? ""
  return (
    response.status === 403 &&
    /cloudfront/i.test(server) &&
    /configured to block access from your country|legal-reasons/i.test(body)
  )
}

function summarizeBody(body) {
  return body.replace(/\s+/g, " ").trim().slice(0, 240)
}

async function upsertCodeFile(framer, source) {
  const files = await framer.getCodeFiles()
  const existing = files.find((file) => file.name === COMPONENT_NAME || file.path === COMPONENT_NAME)
  if (existing) {
    return existing.setFileContent(source)
  }
  return framer.createCodeFile(COMPONENT_NAME, source)
}

async function upsertPrimaryInstance(framer, insertURL, replayAsset) {
  const children = await framer.getChildren(PRIMARY_TARGET.parentId)
  const existing = children.find(
    (node) => node.constructor?.name === "ComponentInstanceNode" && node.componentName === "FinalSparkLiveViz"
  )
  const attributes = {
    name: "FinalSpark Live Visualizer",
    position: "relative",
    width: "1fr",
    height: PRIMARY_TARGET.height,
    controls: {
      preferredSource: "live",
      thresholdUv: 80,
      voltageRangeUv: 160,
      replayFile: replayAsset,
      replayUrl: "",
      title: "Live Activity Dashboard",
      subtitle: "Public LiveMEA windows with crossings, heatmaps, timeline, and electrode mapping.",
    },
  }

  if (existing) {
    await framer.setAttributes(existing.id, attributes)
    await framer.setParent(existing.id, PRIMARY_TARGET.parentId, 1)
    console.log(`${PRIMARY_TARGET.name}: updated existing instance ${existing.id}`)
    return
  }

  const instance = await framer.addComponentInstance({
    url: insertURL,
    attributes,
    parentId: PRIMARY_TARGET.parentId,
  })
  await framer.setParent(instance.id, PRIMARY_TARGET.parentId, 1)
  console.log(`${PRIMARY_TARGET.name}: inserted instance ${instance.id}`)
}

async function verifyReplicaInstances(framer) {
  for (const target of REPLICA_TARGETS) {
    const children = await framer.getChildren(target.parentId)
    const replica = children.find(
      (node) => node.constructor?.name === "ComponentInstanceNode" && node.componentName === "FinalSparkLiveViz"
    )
    if (!replica) {
      throw new Error(`${target.name}: FinalSparkLiveViz replica was not created`)
    }
    console.log(`${target.name}: replica present ${replica.id}`)
  }
}

async function rebrandTemplate(framer) {
  const replacements = new Map([
    ["Alytics", "FinalSpark Live"],
    ["Alytics template adapted for FinalSpark live data", "Template adapted for FinalSpark live data"],
    ["FinalSpark Live MEA", "Live MEA Signal Explorer"],
    ["Live MEA Signal Explorer", "MEA Signal Explorer"],
    [
      "Public FinalSpark voltage windows rendered as threshold crossings, electrode activity, and center-of-activity summaries.",
      "128-electrode voltage windows decoded into threshold crossings, raster activity, heatmaps, and center-of-activity movement.",
    ],
    [
      "128-electrode voltage windows decoded into threshold crossings, raster activity, heatmaps, and center-of-activity movement.",
      "Live 128-electrode voltage windows with raster, heatmap, and activity summaries.",
    ],
    ["Trusted by 1M+ users", "Live public MEA data"],
    ["Turn scattered data into smart decisions", "Watch FinalSpark MEA voltage streams in real time"],
    [
      "One simple dashboard to track your SaaS growth, MRR, churn and user behavior—without the chaos.",
      "A clean interactive dashboard for public FinalSpark MEA windows: voltage traces, threshold crossings, raster events, and activity summaries.",
    ],
    ["No credit card required", "Public stream, no login required"],
    ["Blindly trusted by", "Verified against the live stream"],
    ["Features", "Live"],
    ["Benefits", "Methods"],
    ["Integrations", "Signals"],
    ["Pricing", "Replay"],
    ["Blogs", "Notes"],
    ["Open Live", "Open Explorer"],
    ["Get Started", "Open Explorer"],
    ["Template by Asad Khaleel", "Template adapted for FinalSpark live data"],
    ["Built in Framer . © 2024 Alytics", "FinalSpark Live Visualizer . 2026"],
    ["Subscribe to the Alytics Newsletter!", "Follow the live MEA signal"],
    [
      "Get expert tips, updates, and smart analytics insights delivered straight to your inbox.",
      "Use the live view for streaming activity, or switch to Replay/Demo when the public stream is unavailable.",
    ],
  ])

  const textNodes = await framer.getNodesWithType("TextNode")
  let textUpdates = 0
  for (const node of textNodes) {
    const current = await node.getText().catch(() => null)
    if (typeof current !== "string") continue
    const next = replacements.get(current.trim())
    if (!next || next === current) continue
    await node.setText(next)
    textUpdates += 1
  }

  const componentNodes = await framer.getNodesWithType("ComponentInstanceNode")
  let componentUpdates = 0
  const navLinks = new Map([
    ["Features", "Explorer"],
    ["Live", "Explorer"],
    ["Explorer", "Explorer"],
    ["Benefits", "Protocol"],
    ["Methods", "Protocol"],
    ["Protocol", "Protocol"],
    ["Integrations", "Signals"],
    ["Signals", "Signals"],
    ["Pricing", "Replay"],
    ["Replay", "Replay"],
    ["FAQ", "Status"],
    ["Status", "Status"],
    ["Blogs", "Notes"],
    ["Notes", "Notes"],
  ])
  for (const node of componentNodes) {
    const controls = node.controls || {}
    if (
      node.name === "Footer" ||
      node.componentName === "Footer" ||
      node.name === "Navbar" ||
      node.componentName === "Navbar" ||
      node.name === "Buy Template - Dark" ||
      node.componentName === "Buy Template - Dark" ||
      node.name === "New Template" ||
      node.componentName === "New Template" ||
      node.componentName === "Logo floating" ||
      node.componentName === "Ticker"
    ) {
      if (node.visible !== false) {
        await framer.setAttributes(node.id, { visible: false })
        componentUpdates += 1
      }
      continue
    }

    if (
      node.componentName === "Button" &&
      typeof controls.hKzSQEl_0 === "string" &&
      /Get Template|Get Started|Subscribe|Open Live|Open Explorer/.test(controls.hKzSQEl_0)
    ) {
      await framer.setAttributes(node.id, {
        controls: {
          ...controls,
          hKzSQEl_0: "Open Explorer",
          e5w0UxZNt: "#finalspark-live",
          VEpndFiaz: false,
        },
      })
      componentUpdates += 1
    }

    if (
      node.componentName === "Link" &&
      typeof controls.mSvV0D8Pz === "string" &&
      navLinks.has(controls.mSvV0D8Pz)
    ) {
      await framer.setAttributes(node.id, {
        controls: {
          ...controls,
          mSvV0D8Pz: navLinks.get(controls.mSvV0D8Pz),
          SdWgTx6ev: "#finalspark-live",
        },
      })
      componentUpdates += 1
    }
  }

  const frames = await framer.getNodesWithType("FrameNode")
  const obsoleteSectionNames = new Set([
    "Hero",
    "Dashboard",
    "Features",
    "Benefits",
    "How it works",
    "Integrations",
    "Logos",
    "Testimonials",
    "Pricing",
    "Comparison",
    "FAQ",
    "Blogs",
    "Newsletter",
  ])
  for (const node of frames) {
    if (
      (node.name === "Template Instruction" || obsoleteSectionNames.has(node.name || "")) &&
      node.visible !== false
    ) {
      await framer.setAttributes(node.id, { visible: false })
      componentUpdates += 1
    }
  }

  console.log(`Template rebrand: ${textUpdates} text updates, ${componentUpdates} component/frame updates`)
}

async function upsertPageMetadata(framer) {
  const pages = await framer.getNodesWithType("WebPageNode")
  const homePage = pages.find((page) => page.path === "/")
  if (!homePage) {
    throw new Error("Home page WebPageNode was not found")
  }

  await framer.applyAgentChanges(
    [
      `SET rootNode metadata.title="${escapeDsl(SITE_TITLE)}" metadata.description="${escapeDsl(SITE_DESCRIPTION)}"`,
      `SET ${homePage.id} metadata.title="${escapeDsl(SITE_TITLE)}" metadata.description="${escapeDsl(SITE_DESCRIPTION)}" metadata.noIndex="false" metadata.noIndexSite="false"`,
    ].join("; ") + ";",
    { pagePath: "/" }
  )
  await framer.reviewChangesForAgent({ pagePath: "/" })
  console.log(`Home page metadata ready: ${homePage.id}`)
}

async function upsertSiteMetadata(framer) {
  const overlayCleanupScript = `(() => {
  const hiddenSelectors = "#__framer-badge-container, #__framer-editorbar";
  const hideFramerOverlays = () => {
    for (const element of document.querySelectorAll(hiddenSelectors)) {
      element.setAttribute("aria-hidden", "true");
      element.style.setProperty("display", "none", "important");
      element.style.setProperty("visibility", "hidden", "important");
      element.style.setProperty("opacity", "0", "important");
      element.style.setProperty("pointer-events", "none", "important");
    }
  };

  try {
    window.localStorage?.removeItem("__framer_force_showing_editorbar_since");
  } catch {}

  hideFramerOverlays();
  new MutationObserver(hideFramerOverlays).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();`
  const metadataScript = `(() => {
  const title = ${JSON.stringify(SITE_TITLE)};
  const description = ${JSON.stringify(SITE_DESCRIPTION)};
  document.title = title;
  const tags = [
    ["name", "description", description],
    ["property", "og:title", title],
    ["property", "og:description", description],
    ["name", "twitter:title", title],
    ["name", "twitter:description", description],
  ];
  for (const [attribute, key, content] of tags) {
    const matches = document.querySelectorAll(\`meta[\${attribute}="\${key}"]\`);
    if (matches.length === 0) {
      const element = document.createElement("meta");
      element.setAttribute(attribute, key);
      element.content = content;
      document.head.appendChild(element);
      continue;
    }
    for (const element of matches) element.content = content;
  }
})();`
  await framer.setCustomCode({
    location: "headEnd",
    html: [
      `<title>${escapeHtml(SITE_TITLE)}</title>`,
      `<meta name="description" content="${escapeHtml(SITE_DESCRIPTION)}">`,
      `<meta property="og:title" content="${escapeHtml(SITE_TITLE)}">`,
      `<meta property="og:description" content="${escapeHtml(SITE_DESCRIPTION)}">`,
      `<meta name="twitter:title" content="${escapeHtml(SITE_TITLE)}">`,
      `<meta name="twitter:description" content="${escapeHtml(SITE_DESCRIPTION)}">`,
      `<style data-finalspark-framer-overlay-cleanup>
        #__framer-badge-container,
        #__framer-editorbar {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
      </style>`,
      `<script>${metadataScript}</script>`,
      `<script>${overlayCleanupScript}</script>`,
    ].join("\n"),
  })
  console.log("Site metadata custom code ready")
}

async function readToken() {
  if (process.env.FRAMER_API_KEY) return process.env.FRAMER_API_KEY.trim()

  const converted = spawnSync("textutil", ["-convert", "txt", "-stdout", TOKEN_PATH.pathname], {
    encoding: "utf8",
  })
  if (converted.status === 0 && converted.stdout.trim()) {
    return converted.stdout.trim()
  }

  return (await readFile(TOKEN_PATH, "utf8")).trim()
}

function formatDiagnostics(diagnostics) {
  return diagnostics
    .map((diagnostic) => {
      const text = diagnostic.messageText ?? diagnostic.message ?? JSON.stringify(diagnostic)
      const file = diagnostic.fileName ?? COMPONENT_NAME
      const line = diagnostic.start?.line ?? diagnostic.line ?? "?"
      const column = diagnostic.start?.character ?? diagnostic.character ?? "?"
      return `${file}:${line}:${column} ${text}`
    })
    .join("\n")
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function escapeDsl(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
