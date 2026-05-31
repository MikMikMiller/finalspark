import { connect } from "framer-api"
import { readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"

const PROJECT_URL = "https://framer.com/projects/CpOBrSHMchxEpTjLh4be"
const COMPONENT_NAME = "FinalSparkLiveViz.tsx"
const COMPONENT_PATH = new URL("../framer/FinalSparkLiveViz.tsx", import.meta.url)
const REPLAY_PATH = new URL("../data/replay-sample.json", import.meta.url)
const TOKEN_PATH = new URL("../codexframer.rtf", import.meta.url)

const PRIMARY_TARGET = { name: "Desktop", parentId: "KyMiQ733k", height: "fit-content" }
const REPLICA_TARGETS = [
  { name: "Tablet", parentId: "vHakaUxOYKyMiQ733k" },
  { name: "Phone", parentId: "smYYsX1iwKyMiQ733k" },
]

const shouldPublish = process.argv.includes("--publish")

async function main() {
  const token = await readToken()
  const source = await readFile(COMPONENT_PATH, "utf8")
  const replayBytes = await readFile(REPLAY_PATH)

  let framer
  try {
    framer = await connect(PROJECT_URL, token)
    const project = await framer.getProjectInfo()
    console.log(`Connected to ${project.name}`)

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
    const changed = await framer.getChangedPaths()
    console.log(`Changed paths: ${JSON.stringify(changed)}`)

    if (shouldPublish) {
      const publish = await framer.publish()
      console.log(`Publish: ${JSON.stringify(publish)}`)
    } else {
      console.log("Publish skipped. Re-run with --publish after inspection.")
    }
  } finally {
    if (framer) await framer.disconnect()
  }
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
      title: "Live MEA Signal Explorer",
      subtitle:
        "128-electrode voltage windows decoded into threshold crossings, raster activity, heatmaps, and center-of-activity movement.",
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
    [
      "Public FinalSpark voltage windows rendered as threshold crossings, electrode activity, and center-of-activity summaries.",
      "128-electrode voltage windows decoded into threshold crossings, raster activity, heatmaps, and center-of-activity movement.",
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

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
