import * as React from "react"
import { addPropertyControls, ControlType, useIsStaticRenderer } from "framer"

type SourceMode = "live" | "replay" | "demo"
type StatusLevel = "ok" | "info" | "warn" | "error"

type MeaSample = {
    meaId: number
    data: Float32Array
}

type Frame = {
    source: SourceMode
    timestamp: Date
    sampleRateHz: number
    sampleWindowMs: number
    meas: MeaSample[]
}

type Crossing = {
    absoluteChannel: number
    sampleIndex: number
    timeMs: number
    amplitudeUv: number
}

type RasterEvent = Crossing & {
    absoluteTimeMs: number
}

type Center = {
    active: boolean
    x: number | null
    y: number | null
    totalSpikes: number
}

type TimelinePoint = {
    timestamp: Date
    activeChannels: number
    totalSpikes: number
    populationRateHz: number
}

type ViewState = {
    frame: Frame | null
    counts: Uint16Array
    rates: Float32Array
    heatmapScaleHz: number
    centers: Center[]
    rasterEvents: RasterEvent[]
    timeline: TimelinePoint[]
    selectedTrace: Float32Array | null
    selectedChannel: number
    lastFramePerfMs: number | null
    status: StatusEntry[]
}

type StatusEntry = {
    level: StatusLevel
    message: string
    at: Date
}

type Props = {
    style?: React.CSSProperties
    preferredSource?: SourceMode
    thresholdUv?: number
    voltageRangeUv?: number
    replayFile?: { url?: string } | string
    replayUrl?: string
    title?: string
    subtitle?: string
}

const MEA_COUNT = 4
const CHANNELS_PER_MEA = 32
const CHANNEL_COUNT = 128
const SAMPLE_COUNT = 4096
const SAMPLE_RATE_HZ = 3749.885562574384
const SAMPLE_WINDOW_MS = 1092.3
const RASTER_WINDOW_MS = 12000
const MAX_RASTER_EVENTS = 12000
const TIMELINE_POINTS = 44
const SOCKET_IO_URL =
    "wss://livemeaservice.finalspark.com/socket.io/?EIO=4&transport=websocket"
const FINALSPARK_LOGO_URL =
    "https://finalspark.com/wp-content/uploads/2024/03/FinalSpark-Logo-White.svg"
const SITE_TITLE = "FinalSpark Live Activity Dashboard"
const SITE_DESCRIPTION =
    "Public LiveMEA windows with crossings, heatmaps, timeline, and electrode mapping."
const COLORS = {
    ink: "#202722",
    muted: "#68717a",
    paper: "#f7f9fb",
    surface: "#fffef7",
    line: "#d7dee7",
    lineStrong: "#aebcca",
    brand: "#2ea3f2",
    brandDark: "#0879ca",
    brandSoft: "#eaf6ff",
    rust: "#bb4b36",
    amber: "#a46221",
    secondaryBlue: "#386ca3",
    hot: "#eb6817",
    chartPaper: "#fbfdff",
    grid: "#edf2f7",
}
const MEA_COLORS = [COLORS.brand, COLORS.hot, COLORS.secondaryBlue, COLORS.rust] as const

const SOURCE_LABEL: Record<SourceMode, string> = {
    live: "Live",
    replay: "Replay",
    demo: "Demo",
}

const SOURCE_MODES = new Set<SourceMode>(["live", "replay", "demo"])
const VOLTAGE_RANGES = [80, 120, 160, 200, 320] as const

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
})

const EMPTY_VIEW_STATE: ViewState = {
    frame: null,
    counts: new Uint16Array(CHANNEL_COUNT),
    rates: new Float32Array(CHANNEL_COUNT),
    heatmapScaleHz: 20,
    centers: Array.from({ length: MEA_COUNT }, () => ({
        active: false,
        x: null,
        y: null,
        totalSpikes: 0,
    })),
    rasterEvents: [],
    timeline: [],
    selectedTrace: null,
    selectedChannel: 0,
    lastFramePerfMs: null,
    status: [],
}

/**
 * @framerSupportedLayoutWidth any-prefer-fixed
 * @framerSupportedLayoutHeight any-prefer-fixed
 * @framerIntrinsicWidth 1200
 * @framerIntrinsicHeight 1040
 */
export default function FinalSparkLiveViz(props: Props) {
    const {
        style,
        title = "MEA Signal Explorer",
        subtitle = "Live 128-electrode voltage windows with raster, heatmap, and activity summaries.",
        preferredSource = "live",
        thresholdUv: initialThreshold = 80,
        voltageRangeUv: initialRange = 160,
    } = props

    const isStaticRenderer = useIsStaticRenderer()
    const [hasMounted, setHasMounted] = React.useState(false)
    const [urlStateReady, setUrlStateReady] = React.useState(false)
    const [source, setSource] = React.useState<SourceMode>(() => normalizeSource(preferredSource))
    const [thresholdUv, setThresholdUv] = React.useState(() => normalizeThreshold(initialThreshold))
    const [voltageRangeUv, setVoltageRangeUv] = React.useState(() => normalizeVoltageRange(initialRange))
    const [absoluteLabels, setAbsoluteLabels] = React.useState(false)
    const [paused, setPaused] = React.useState(false)
    const [controlsOpen, setControlsOpen] = React.useState(true)
    const [clockTick, setClockTick] = React.useState(0)
    const [view, setView] = React.useState<ViewState>(EMPTY_VIEW_STATE)

    const pausedRef = React.useRef(false)
    const thresholdRef = React.useRef(initialThreshold)
    const controlsTouchedRef = React.useRef(false)
    const historyRef = React.useRef({
        rasterEvents: [] as RasterEvent[],
        timeline: [] as TimelinePoint[],
    })

    React.useEffect(() => {
        installStyles()
    }, [])

    React.useEffect(() => {
        setHasMounted(true)
    }, [])

    React.useEffect(() => {
        updateDocumentMetadata(SITE_TITLE, SITE_DESCRIPTION)
    }, [])

    React.useEffect(() => {
        pausedRef.current = paused
    }, [paused])

    React.useEffect(() => {
        thresholdRef.current = thresholdUv
    }, [thresholdUv])

    React.useEffect(() => {
        setThresholdUv(normalizeThreshold(initialThreshold))
    }, [initialThreshold])

    React.useEffect(() => {
        setVoltageRangeUv(normalizeVoltageRange(initialRange))
    }, [initialRange])

    React.useEffect(() => {
        if (typeof window === "undefined") return
        setClockTick(typeof performance === "undefined" ? Date.now() : performance.now())
        const timer = window.setInterval(() => {
            setClockTick(typeof performance === "undefined" ? Date.now() : performance.now())
        }, 1000)
        return () => window.clearInterval(timer)
    }, [])

    React.useEffect(() => {
        if (typeof window === "undefined") return
        const query = window.matchMedia("(max-width: 520px)")
        const sync = () => {
            if (!controlsTouchedRef.current) setControlsOpen(!query.matches)
        }
        sync()
        query.addEventListener?.("change", sync)
        return () => query.removeEventListener?.("change", sync)
    }, [])

    React.useEffect(() => {
        if (!hasMounted || typeof window === "undefined" || isStaticRenderer) return
        setSource(getInitialUrlSource(preferredSource))
        setThresholdUv(getInitialUrlNumber("threshold", initialThreshold, 20, 260, 5))
        setVoltageRangeUv(getInitialUrlRange(initialRange))
        setAbsoluteLabels(getInitialUrlLabels(false))
        setUrlStateReady(true)
    }, [hasMounted, preferredSource, initialThreshold, initialRange, isStaticRenderer])

    React.useEffect(() => {
        if (!hasMounted || !urlStateReady || typeof window === "undefined" || isStaticRenderer) return
        const params = new URLSearchParams(window.location.search)
        params.set("source", source)
        params.set("threshold", String(thresholdUv))
        params.set("range", String(voltageRangeUv))
        params.set("labels", absoluteLabels ? "absolute" : "local")
        window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`)
    }, [source, thresholdUv, voltageRangeUv, absoluteLabels, hasMounted, urlStateReady, isStaticRenderer])

    React.useEffect(() => {
        if (!hasMounted) return
        const replayUrl = resolveReplayUrl(props.replayFile, props.replayUrl)
        const activeSource = isStaticRenderer ? "demo" : source
        let stopped = false
        let cleanup = () => {}

        historyRef.current = { rasterEvents: [], timeline: [] }
        setView((previous) => ({
            ...EMPTY_VIEW_STATE,
            status: [
                makeStatus(
                    "info",
                    isStaticRenderer
                        ? "Static Framer renderer is using demo data."
                        : `Starting ${SOURCE_LABEL[activeSource]} source.`
                ),
            ],
        }))

        const onFrame = (frame: Frame) => {
            if (stopped || pausedRef.current) return
            setView((previous) =>
                consumeFrame(frame, thresholdRef.current, historyRef.current, previous)
            )
        }

        const onStatus = (level: StatusLevel, message: string) => {
            if (stopped) return
            setView((previous) => ({
                ...previous,
                status: [makeStatus(level, message), ...previous.status].slice(0, 5),
            }))
        }

        if (activeSource === "demo") {
            cleanup = startDemoSource(onFrame, onStatus)
        } else if (activeSource === "replay") {
            cleanup = startReplaySource(replayUrl, onFrame, onStatus)
        } else {
            cleanup = startLiveSource(onFrame, onStatus)
        }

        return () => {
            stopped = true
            cleanup()
        }
    }, [hasMounted, source, props.replayFile, props.replayUrl, isStaticRenderer])

    const population = computePopulationActivity(
        view.counts,
        view.frame?.sampleWindowMs ?? SAMPLE_WINDOW_MS
    )
    const sampleBadges = view.frame
        ? [
              SOURCE_LABEL[view.frame.source],
              `${view.frame.meas.length}/4 MEAs`,
              TIME_FORMATTER.format(view.frame.timestamp),
          ]
        : ["Waiting"]
    const noise = view.selectedTrace ? summarizeNoiseBand(view.selectedTrace) : null
    const selectedChannel = mapChannel(view.selectedChannel)
    const latestTimeline = view.timeline[view.timeline.length - 1]
    const activeCenters = view.centers.filter((center) => center.active).length
    const currentHeatmapPeak = maxRate(view.rates)
    const latestStatus = view.status[0]
    const freshnessLabel =
        view.frame && view.lastFramePerfMs !== null
            ? `Last frame ${formatFrameAge(clockTick - view.lastFramePerfMs)} | ${view.frame.meas.length}/4 MEAs | ${population.activeChannels} active`
            : "Waiting for frame"
    const controlSummary = `${thresholdUv} uV | +/-${voltageRangeUv} uV | ${
        absoluteLabels ? "Absolute labels" : "Local labels"
    }`
    const meaSummary = splitCountsByMea(view.counts).map((counts, index) => {
        let total = 0
        let active = 0
        for (const count of counts) {
            total += count
            if (count > 0) active += 1
        }
        return { meaId: index + 1, total, active }
    })
    const chartMeta = {
        raster: view.rasterEvents.length
            ? `${view.rasterEvents.length} crossings | ${(RASTER_WINDOW_MS / 1000).toFixed(0)} s`
            : `${(RASTER_WINDOW_MS / 1000).toFixed(0)} s window`,
        heatmap: currentHeatmapPeak > 0
            ? `Peak ${currentHeatmapPeak.toFixed(1)} Hz | Scale 0-${view.heatmapScaleHz.toFixed(1)}`
            : `Scale 0-${view.heatmapScaleHz.toFixed(1)} Hz`,
        timeline: latestTimeline
            ? `${latestTimeline.populationRateHz.toFixed(1)} Hz | ${latestTimeline.activeChannels} active`
            : "Waiting",
        center: `${activeCenters}/4 active`,
        signal: view.frame
            ? `+/-${thresholdUv} uV | ${formatChannelLabel(selectedChannel, absoluteLabels)}`
            : `+/-${thresholdUv} uV`,
    }
    const chartSummaries = {
        raster: view.rasterEvents.length
            ? `${view.rasterEvents.length} crossings are visible in the last ${(RASTER_WINDOW_MS / 1000).toFixed(0)} seconds.`
            : "Waiting for threshold crossings.",
        heatmap: currentHeatmapPeak > 0
            ? `Current heatmap peak is ${currentHeatmapPeak.toFixed(1)} Hz; color scale is stabilized at ${view.heatmapScaleHz.toFixed(1)} Hz.`
            : "Waiting for firing-rate data.",
        timeline: latestTimeline
            ? `Latest point: ${latestTimeline.totalSpikes} crossings, ${latestTimeline.activeChannels} active electrodes, ${latestTimeline.populationRateHz.toFixed(2)} Hz.`
            : "Waiting for timeline data.",
        center: activeCenters
            ? `${activeCenters}/4 MEA centers are active in the current window.`
            : "Waiting for center-of-activity data.",
        signal: view.frame
            ? `Signal trace is following ${formatChannelLabel(selectedChannel, absoluteLabels)} on MEA ${selectedChannel.meaId} at +/-${voltageRangeUv} uV.`
            : "Waiting for probe-channel signal data.",
    }

    const clearHistory = () => {
        historyRef.current = { rasterEvents: [], timeline: [] }
        setView((previous) => ({
            ...previous,
            rasterEvents: [],
            timeline: [],
            status: [makeStatus("info", "Cleared rolling raster and timeline."), ...previous.status].slice(0, 5),
        }))
    }

    return (
        <section id="finalspark-live" className="fs-viz" style={style} data-source={source}>
            <div className="fs-viz__shell">
                <header className="fs-viz__header">
                    <div className="fs-viz__brand">
                        <img
                            className="fs-viz__logo"
                            src={FINALSPARK_LOGO_URL}
                            alt="FinalSpark"
                            width={180}
                            height={40}
                        />
                        <div className="fs-viz__intro">
                            <h1>{title}</h1>
                            <p className="fs-viz__subtitle">{subtitle}</p>
                        </div>
                    </div>
                </header>

                <div className="fs-viz__toolbar" aria-label="Visualizer controls">
                    <div className="fs-viz__segmented" role="group" aria-label="Source">
                        {(["live", "replay", "demo"] as SourceMode[]).map((mode) => (
                            <button
                                key={mode}
                                type="button"
                                aria-pressed={source === mode}
                                data-active={source === mode}
                                onClick={() => setSource(mode)}
                            >
                                {SOURCE_LABEL[mode]}
                            </button>
                        ))}
                    </div>

                    <details
                        className="fs-viz__controls-drawer"
                        open={controlsOpen}
                        onToggle={(event) => {
                            controlsTouchedRef.current = true
                            setControlsOpen(event.currentTarget.open)
                        }}
                    >
                        <summary>
                            <span>Controls</span>
                            <small>{controlSummary}</small>
                        </summary>
                        <div className="fs-viz__controls-body">
                            <label className="fs-viz__control">
                                <span>Threshold</span>
                                <input
                                    name="thresholdUv"
                                    type="range"
                                    min={20}
                                    max={260}
                                    step={5}
                                    value={thresholdUv}
                                    autoComplete="off"
                                    onChange={(event) => setThresholdUv(Number(event.currentTarget.value))}
                                />
                                <strong>{thresholdUv} uV</strong>
                            </label>

                            <label className="fs-viz__select">
                                <span>Signal range</span>
                                <select
                                    name="traceRangeUv"
                                    value={voltageRangeUv}
                                    autoComplete="off"
                                    onChange={(event) => setVoltageRangeUv(Number(event.currentTarget.value))}
                                >
                                    {VOLTAGE_RANGES.map((value) => (
                                        <option key={value} value={value}>
                                            +/-{value} uV
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className="fs-viz__toggle">
                                <input
                                    name="absoluteLabels"
                                    type="checkbox"
                                    checked={absoluteLabels}
                                    autoComplete="off"
                                    onChange={(event) => setAbsoluteLabels(event.currentTarget.checked)}
                                />
                                <span>Absolute channel labels</span>
                            </label>
                        </div>
                    </details>

                    <button type="button" className="fs-viz__button" onClick={() => setPaused(!paused)}>
                        {paused ? "Resume" : "Pause"}
                    </button>
                    <button type="button" className="fs-viz__button" onClick={clearHistory}>
                        Clear
                    </button>
                    <div className="fs-viz__status" aria-live="polite" data-level={latestStatus?.level ?? "info"}>
                        <span>Stream status</span>
                        <strong>{latestStatus?.message ?? "No socket activity yet."}</strong>
                        <small className="fs-viz__freshness">{freshnessLabel}</small>
                        <details className="fs-viz__status-log">
                            <summary>Log</summary>
                            <div>
                                {view.status.slice(0, 4).map((entry) => (
                                    <span key={`${entry.at.toISOString()}-${entry.message}`} data-level={entry.level}>
                                        {TIME_FORMATTER.format(entry.at)} - {entry.message}
                                    </span>
                                ))}
                            </div>
                        </details>
                    </div>
                </div>

                <div className="fs-viz__metrics">
                    <SampleMetric label="Sample" badges={sampleBadges} />
                    <Metric label="Population rate" value={`${population.populationRateHz.toFixed(2)} Hz`} />
                    <Metric label="Active electrodes" value={String(population.activeChannels)} />
                    <Metric label="Threshold crossings" value={String(population.totalSpikes)} />
                    <Metric label="Sample rate" value={`${SAMPLE_RATE_HZ.toFixed(1)} Hz`} />
                </div>

                <MeaSummary items={meaSummary} />

                <div className="fs-viz__grid">
                    <Panel
                        className="fs-viz__panel--wide"
                        title="Live raster"
                        copy="Rolling threshold crossings across 128 electrodes."
                        meta={chartMeta.raster}
                        summary={chartSummaries.raster}
                    >
                        <RasterCanvas
                            events={view.rasterEvents}
                            absoluteLabels={absoluteLabels}
                            windowMs={RASTER_WINDOW_MS}
                        />
                    </Panel>

                    <Panel
                        className="fs-viz__panel--wide"
                        title="Electrode activity"
                        copy="Per-channel firing rate estimate for the latest window."
                        meta={chartMeta.heatmap}
                        summary={chartSummaries.heatmap}
                    >
                        <HeatMapCanvas
                            rates={view.rates}
                            absoluteLabels={absoluteLabels}
                            scaleMaxHz={view.heatmapScaleHz}
                        />
                        <HeatmapLegend maxHz={view.heatmapScaleHz} />
                    </Panel>

                    <Panel
                        title="Population timeline"
                        copy="Recent total activity and active electrode count."
                        meta={chartMeta.timeline}
                        summary={chartSummaries.timeline}
                    >
                        <TimelineCanvas timeline={view.timeline} />
                    </Panel>

                    <Panel
                        title="Center of activity"
                        copy="Weighted by threshold crossings per MEA."
                        meta={chartMeta.center}
                        summary={chartSummaries.center}
                    >
                        <CenterCanvas centers={view.centers} />
                    </Panel>

                    <Panel
                        className="fs-viz__panel--wide"
                        title="Signal versus threshold"
                        copy="Most active electrode in the latest frame."
                        meta={chartMeta.signal}
                        summary={chartSummaries.signal}
                    >
                        <SignalCanvas
                            trace={view.selectedTrace}
                            thresholdUv={thresholdUv}
                            rangeUv={voltageRangeUv}
                        />
                    </Panel>

                    <details className="fs-viz__help">
                        <summary>
                            <span>Reading the stream</span>
                            <small>MEA, biochip, threshold, and activity terms</small>
                        </summary>
                        <dl>
                            <div>
                                <dt>MEA</dt>
                                <dd>A multi-electrode array. This component shows 4 MEAs, 32 electrodes each.</dd>
                            </div>
                            <div>
                                <dt>Biochip</dt>
                                <dd>Each MEA is grouped into four logical 8-electrode biochips.</dd>
                            </div>
                            <div>
                                <dt>Window</dt>
                                <dd>Each pushed frame contains 4096 samples, roughly 1092.3 ms of raw voltage.</dd>
                            </div>
                            <div>
                                <dt>Threshold</dt>
                                <dd>Crossings are simple voltage threshold events. No unit identity is inferred.</dd>
                            </div>
                            <div>
                                <dt>Center of activity</dt>
                                <dd>A statistical average position weighted by crossing counts, not a biological region.</dd>
                            </div>
                        </dl>
                        <p>
                            Mapping check: absolute 37 = MEA 2, local 05, biochip 0, electrode 5.
                        </p>
                    </details>
                </div>

                <footer className="fs-viz__footer">
                    <p>
                        Probe electrode {formatChannelLabel(selectedChannel, absoluteLabels)} on MEA{" "}
                        {selectedChannel.meaId}:{" "}
                        {noise
                            ? `center ${noise.centerUv} uV, noise floor ${noise.noiseFloorUv} uV.`
                            : "waiting for signal statistics."}
                    </p>
                    <p>
                        Public-stream-only learning project with live, replay, and demo modes for inspectable
                        browser rendering.
                    </p>
                </footer>
            </div>
        </section>
    )
}

const defaultProps: Partial<Props> = {
    preferredSource: "live",
    thresholdUv: 80,
    voltageRangeUv: 160,
    title: "Live Activity Dashboard",
    subtitle: "Public LiveMEA windows with crossings, heatmaps, timeline, and electrode mapping.",
}

FinalSparkLiveViz.defaultProps = defaultProps

addPropertyControls(FinalSparkLiveViz, {
    preferredSource: {
        type: ControlType.Enum,
        title: "Source",
        options: ["live", "replay", "demo"],
        optionTitles: ["Live", "Replay", "Demo"],
        defaultValue: "live",
    },
    thresholdUv: {
        type: ControlType.Number,
        title: "Threshold",
        min: 20,
        max: 260,
        step: 5,
        defaultValue: 80,
        unit: "uV",
    },
    voltageRangeUv: {
        type: ControlType.Number,
        title: "Range",
        min: 80,
        max: 320,
        step: 40,
        defaultValue: 160,
        unit: "uV",
    },
    replayFile: {
        type: ControlType.File,
        title: "Replay JSON",
        allowedFileTypes: ["json"],
    },
    replayUrl: {
        type: ControlType.String,
        title: "Replay URL",
        defaultValue: "",
    },
    title: {
        type: ControlType.String,
        title: "Title",
        defaultValue: "Live Activity Dashboard",
    },
    subtitle: {
        type: ControlType.String,
        title: "Subtitle",
        displayTextArea: true,
        defaultValue:
            "A browser-based view of public multi-electrode-array voltage windows from FinalSpark, rendered with threshold crossings, population activity, and center-of-activity summaries.",
    },
})

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="fs-viz__metric">
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    )
}

function SampleMetric({ label, badges }: { label: string; badges: string[] }) {
    return (
        <div className="fs-viz__metric fs-viz__metric--sample">
            <span>{label}</span>
            <div className="fs-viz__sample-badges">
                {badges.map((badge) => (
                    <strong key={badge}>{badge}</strong>
                ))}
            </div>
        </div>
    )
}

function MeaSummary({ items }: { items: Array<{ meaId: number; total: number; active: number }> }) {
    return (
        <div className="fs-viz__mea-strip" aria-label="MEA summary">
            {items.map((item) => (
                <div className="fs-viz__mea-stat" key={item.meaId}>
                    <strong>MEA {item.meaId}</strong>
                    <span>{item.total}</span>
                    <small>{item.active}/32 active</small>
                </div>
            ))}
        </div>
    )
}

function HeatmapLegend({ maxHz }: { maxHz: number }) {
    return (
        <div className="fs-viz__heatmap-legend" aria-label="Heatmap color scale">
            <span>0 Hz</span>
            <span className="fs-viz__heatmap-ramp" aria-hidden="true" />
            <span>{maxHz.toFixed(1)} Hz</span>
        </div>
    )
}

function Panel({
    title,
    copy,
    meta,
    summary,
    children,
    className = "",
}: {
    title: string
    copy: string
    meta?: string
    summary?: string
    children: React.ReactNode
    className?: string
}) {
    return (
        <article className={`fs-viz__panel ${className}`}>
            <div className="fs-viz__panel-head">
                <div>
                    <h2>{title}</h2>
                    <p>{copy}</p>
                </div>
                {meta ? <span className="fs-viz__panel-meta">{meta}</span> : null}
            </div>
            {children}
            {summary ? <p className="fs-viz__chart-summary">{summary}</p> : null}
        </article>
    )
}

function RasterCanvas({
    events,
    windowMs,
    absoluteLabels,
}: {
    events: RasterEvent[]
    windowMs: number
    absoluteLabels: boolean
}) {
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null)

    React.useEffect(() => {
        return drawResponsiveCanvas(canvasRef.current, (ctx, width, height) => {
            drawRaster(ctx, width, height, events, windowMs, absoluteLabels)
        })
    }, [events, windowMs, absoluteLabels])

    return (
        <canvas
            ref={canvasRef}
            className="fs-viz__canvas fs-viz__canvas--raster"
            role="img"
            aria-label="Rolling raster plot of threshold crossings across 128 electrodes."
        >
            Rolling raster plot of threshold crossings across 128 electrodes.
        </canvas>
    )
}

function HeatMapCanvas({
    rates,
    absoluteLabels,
    scaleMaxHz,
}: {
    rates: Float32Array
    absoluteLabels: boolean
    scaleMaxHz: number
}) {
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null)

    React.useEffect(() => {
        return drawResponsiveCanvas(canvasRef.current, (ctx, width, height) => {
            drawHeatMap(ctx, width, height, rates, absoluteLabels, scaleMaxHz)
        })
    }, [rates, absoluteLabels, scaleMaxHz])

    return (
        <canvas
            ref={canvasRef}
            className="fs-viz__canvas fs-viz__canvas--medium fs-viz__canvas--heatmap"
            role="img"
            aria-label="Firing-rate heatmap for four MEAs."
        >
            Firing-rate heatmap for four MEAs.
        </canvas>
    )
}

function TimelineCanvas({ timeline }: { timeline: TimelinePoint[] }) {
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null)

    React.useEffect(() => {
        return drawResponsiveCanvas(canvasRef.current, (ctx, width, height) => {
            drawTimeline(ctx, width, height, timeline)
        })
    }, [timeline])

    return (
        <canvas
            ref={canvasRef}
            className="fs-viz__canvas fs-viz__canvas--medium"
            role="img"
            aria-label="Population activity timeline."
        >
            Population activity timeline.
        </canvas>
    )
}

function CenterCanvas({ centers }: { centers: Center[] }) {
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null)

    React.useEffect(() => {
        return drawResponsiveCanvas(canvasRef.current, (ctx, width, height) => {
            drawCenterOfActivity(ctx, width, height, centers)
        })
    }, [centers])

    return (
        <canvas
            ref={canvasRef}
            className="fs-viz__canvas fs-viz__canvas--medium fs-viz__canvas--center"
            role="img"
            aria-label="Weighted center of activity by MEA."
        >
            Weighted center of activity by MEA.
        </canvas>
    )
}

function SignalCanvas({
    trace,
    thresholdUv,
    rangeUv,
}: {
    trace: Float32Array | null
    thresholdUv: number
    rangeUv: number
}) {
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null)

    React.useEffect(() => {
        return drawResponsiveCanvas(canvasRef.current, (ctx, width, height) => {
            drawSignal(ctx, width, height, trace, thresholdUv, rangeUv)
        })
    }, [trace, thresholdUv, rangeUv])

    return (
        <canvas
            ref={canvasRef}
            className="fs-viz__canvas fs-viz__canvas--medium"
            role="img"
            aria-label="Voltage trace for the most active electrode against the current threshold."
        >
            Voltage trace for the most active electrode against the current threshold.
        </canvas>
    )
}

function drawResponsiveCanvas(
    canvas: HTMLCanvasElement | null,
    draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void
) {
    if (!canvas) return () => {}
    const ctx = canvas.getContext("2d")
    if (!ctx) return () => {}

    const render = () => {
        const rect = canvas.getBoundingClientRect()
        const ratio = Math.max(1, window.devicePixelRatio || 1)
        const width = Math.max(1, Math.floor(rect.width))
        const height = Math.max(1, Math.floor(rect.height))
        canvas.width = Math.floor(width * ratio)
        canvas.height = Math.floor(height * ratio)
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
        draw(ctx, width, height)
    }

    render()
    const resizeObserver = new ResizeObserver(render)
    resizeObserver.observe(canvas)
    return () => resizeObserver.disconnect()
}

function startLiveSource(
    onFrame: (frame: Frame) => void,
    onStatus: (level: StatusLevel, message: string) => void
) {
    const latest = new Map<number, MeaSample>()
    const sockets = Array.from({ length: MEA_COUNT }, (_, index) => {
        const socket = new LiveMeaSocket(index, (sample) => {
            latest.set(sample.meaId, sample)
            onFrame({
                source: "live",
                timestamp: new Date(),
                sampleRateHz: SAMPLE_RATE_HZ,
                sampleWindowMs: SAMPLE_WINDOW_MS,
                meas: Array.from(latest.values()).sort((a, b) => a.meaId - b.meaId),
            })
        }, onStatus)
        socket.connect()
        return socket
    })

    onStatus("info", "Opening four public FinalSpark stream sockets.")
    return () => sockets.forEach((socket) => socket.stop())
}

class LiveMeaSocket {
    private ws: WebSocket | null = null
    private stopped = false
    private reconnectTimer: number | null = null
    private reconnectAttempt = 0
    private namespaceReady = false
    private engineReady = false

    constructor(
        private readonly zeroBasedMeaIndex: number,
        private readonly onSample: (sample: MeaSample) => void,
        private readonly onStatus: (level: StatusLevel, message: string) => void
    ) {}

    connect() {
        if (this.stopped) return

        this.namespaceReady = false
        this.engineReady = false
        const meaId = this.zeroBasedMeaIndex + 1
        this.onStatus("info", `MEA ${meaId}: connecting.`)

        try {
            this.ws = new WebSocket(SOCKET_IO_URL)
            this.ws.binaryType = "arraybuffer"
        } catch (error) {
            this.scheduleReconnect(`MEA ${meaId}: ${errorMessage(error)}`)
            return
        }

        this.ws.addEventListener("open", () => {
            this.onStatus("info", `MEA ${meaId}: socket open.`)
        })
        this.ws.addEventListener("message", (event) => this.handleMessage(event.data))
        this.ws.addEventListener("close", () => {
            if (!this.stopped) this.scheduleReconnect(`MEA ${meaId}: stream closed.`)
        })
        this.ws.addEventListener("error", () => {
            if (!this.stopped) this.onStatus("warn", `MEA ${meaId}: socket error.`)
        })
    }

    stop() {
        this.stopped = true
        if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
        if (!this.ws) return
        if (this.ws.readyState === WebSocket.CONNECTING) {
            this.ws.addEventListener("open", () => this.ws?.close(), { once: true })
        } else {
            this.ws.close()
        }
        this.ws = null
    }

    private handleMessage(data: string | ArrayBuffer | Blob) {
        if (this.stopped) return
        if (typeof data === "string") {
            this.handleTextPacket(data)
            return
        }
        if (data instanceof ArrayBuffer) {
            this.handleBinaryPacket(data)
            return
        }
        data.arrayBuffer().then((buffer) => this.handleBinaryPacket(buffer))
    }

    private handleTextPacket(packet: string) {
        if (packet.startsWith("0{") && !this.engineReady) {
            this.engineReady = true
            this.ws?.send("40")
            return
        }
        if (packet.startsWith("40") && !this.namespaceReady) {
            this.namespaceReady = true
            this.ws?.send(`42["meaid",${this.zeroBasedMeaIndex}]`)
            return
        }
        if (packet === "2") this.ws?.send("3")
    }

    private handleBinaryPacket(buffer: ArrayBuffer) {
        const meaId = this.zeroBasedMeaIndex + 1
        if (buffer.byteLength !== CHANNELS_PER_MEA * SAMPLE_COUNT * 4) {
            this.onStatus("warn", `MEA ${meaId}: ignored ${buffer.byteLength} byte frame.`)
            return
        }
        this.reconnectAttempt = 0
        this.onSample({
            meaId,
            data: new Float32Array(buffer.slice(0)),
        })
    }

    private scheduleReconnect(reason: string) {
        if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
        const delay = Math.min(30000, 1000 * 2 ** this.reconnectAttempt)
        this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 5)
        this.onStatus("warn", `${reason} Reconnecting in ${delay} ms.`)
        this.reconnectTimer = window.setTimeout(() => this.connect(), delay)
    }
}

function startReplaySource(
    replayUrl: string | null,
    onFrame: (frame: Frame) => void,
    onStatus: (level: StatusLevel, message: string) => void
) {
    let stopped = false
    let timer: number | null = null

    const emitFrame = (frame: Frame) => {
        if (stopped) return
        onFrame({ ...frame, timestamp: new Date() })
        timer = window.setTimeout(() => emitFrame(frame), frame.sampleWindowMs)
    }

    if (!replayUrl) {
        onStatus("warn", "Replay JSON is not attached; using demo source.")
        return startDemoSource(onFrame, onStatus)
    }

    fetch(replayUrl)
        .then((response) => {
            if (!response.ok) throw new Error(`Replay fetch failed: ${response.status}`)
            return response.json()
        })
        .then((payload) => decodeReplay(payload))
        .then((frame) => {
            onStatus("ok", "Replay fixture loaded from Framer file asset.")
            emitFrame(frame)
        })
        .catch((error) => {
            if (stopped) return
            onStatus("error", `${errorMessage(error)} Falling back to demo source.`)
            const cleanupDemo = startDemoSource(onFrame, onStatus)
            const previousCleanup = () => cleanupDemo()
            cleanup = previousCleanup
        })

    let cleanup = () => {
        stopped = true
        if (timer !== null) window.clearTimeout(timer)
    }

    return () => cleanup()
}

function startDemoSource(
    onFrame: (frame: Frame) => void,
    onStatus: (level: StatusLevel, message: string) => void
) {
    let phase = 0
    let timer: number | null = null
    const random = mulberry32(0x5123ab)

    const emit = () => {
        phase += 1
        onFrame({
            source: "demo",
            timestamp: new Date(),
            sampleRateHz: SAMPLE_RATE_HZ,
            sampleWindowMs: SAMPLE_WINDOW_MS,
            meas: [1, 2, 3, 4].map((meaId) => ({
                meaId,
                data: makeDemoMea(meaId, phase, random),
            })),
        })
        timer = window.setTimeout(emit, SAMPLE_WINDOW_MS)
    }

    onStatus("ok", "Synthetic demo source is running in-browser.")
    emit()

    return () => {
        if (timer !== null) window.clearTimeout(timer)
    }
}

function consumeFrame(
    frame: Frame,
    thresholdUv: number,
    history: { rasterEvents: RasterEvent[]; timeline: TimelinePoint[] },
    previous: ViewState
): ViewState {
    const crossings = detectFrameCrossings(frame.meas, thresholdUv, frame.sampleRateHz)
    const counts = countSpikesByChannel(crossings)
    const rates = computeFiringRates(counts, frame.sampleWindowMs)
    const frameMaxRate = Math.max(20, maxRate(rates))
    const heatmapScaleHz = Math.max(frameMaxRate, previous.heatmapScaleHz * 0.96)
    const centers = splitCountsByMea(counts).map((localCounts, index) =>
        computeCenterOfActivity(localCounts, channelsForMea(index + 1))
    )
    const nowMs = performance.now()

    for (const crossing of crossings) {
        history.rasterEvents.push({
            ...crossing,
            absoluteTimeMs: nowMs - frame.sampleWindowMs + crossing.timeMs,
        })
    }
    history.rasterEvents = history.rasterEvents.filter(
        (event) => nowMs - event.absoluteTimeMs <= RASTER_WINDOW_MS
    )
    if (history.rasterEvents.length > MAX_RASTER_EVENTS) {
        history.rasterEvents = history.rasterEvents.slice(-MAX_RASTER_EVENTS)
    }
    history.timeline = [
        ...history.timeline,
        { timestamp: frame.timestamp, ...computePopulationActivity(counts, frame.sampleWindowMs) },
    ].slice(-TIMELINE_POINTS)

    const selectedChannel = findMostActiveChannel(counts)
    const selectedTrace = channelTraceFromFrame(frame, selectedChannel)

    return {
        ...previous,
        frame,
        counts,
        rates,
        heatmapScaleHz,
        centers,
        rasterEvents: [...history.rasterEvents],
        timeline: [...history.timeline],
        selectedChannel,
        selectedTrace,
        lastFramePerfMs: performance.now(),
    }
}

function detectFrameCrossings(
    meas: MeaSample[],
    thresholdUv: number,
    sampleRateHz: number
) {
    const crossings: Crossing[] = []
    for (const mea of meas) {
        const baseChannel = (mea.meaId - 1) * CHANNELS_PER_MEA
        for (let localIndex = 0; localIndex < CHANNELS_PER_MEA; localIndex += 1) {
            const start = localIndex * SAMPLE_COUNT
            const trace = mea.data.subarray(start, start + SAMPLE_COUNT)
            crossings.push(
                ...detectThresholdCrossings(trace, baseChannel + localIndex, thresholdUv, sampleRateHz)
            )
        }
    }
    return crossings
}

function detectThresholdCrossings(
    trace: Float32Array,
    absoluteChannel: number,
    thresholdUv: number,
    sampleRateHz: number
) {
    const crossings: Crossing[] = []
    const refractorySamples = Math.max(1, Math.round((2 / 1000) * sampleRateHz))
    let lastCrossingSample = -Infinity
    let previousAbs = Math.abs(trace[0] ?? 0)

    for (let sampleIndex = 1; sampleIndex < trace.length; sampleIndex += 1) {
        const value = trace[sampleIndex]
        const absValue = Math.abs(value)
        const crossed = previousAbs < thresholdUv && absValue >= thresholdUv
        const outsideRefractory = sampleIndex - lastCrossingSample >= refractorySamples

        if (crossed && outsideRefractory) {
            crossings.push({
                absoluteChannel,
                sampleIndex,
                timeMs: round((sampleIndex / sampleRateHz) * 1000, 3),
                amplitudeUv: round(value, 3),
            })
            lastCrossingSample = sampleIndex
        }
        previousAbs = absValue
    }

    return crossings
}

function countSpikesByChannel(crossings: Crossing[]) {
    const counts = new Uint16Array(CHANNEL_COUNT)
    for (const crossing of crossings) {
        if (crossing.absoluteChannel >= 0 && crossing.absoluteChannel < CHANNEL_COUNT) {
            counts[crossing.absoluteChannel] += 1
        }
    }
    return counts
}

function computeFiringRates(spikeCounts: Uint16Array, windowMs: number) {
    const seconds = windowMs / 1000
    return Float32Array.from(spikeCounts, (count) => round(count / seconds, 3))
}

function computeCenterOfActivity(localSpikeCounts: Uint16Array, channels: ReturnType<typeof mapChannel>[]) {
    let weightedX = 0
    let weightedY = 0
    let totalSpikes = 0

    for (let index = 0; index < localSpikeCounts.length; index += 1) {
        const count = localSpikeCounts[index]
        if (count <= 0) continue
        const channel = channels[index]
        weightedX += channel.x * count
        weightedY += channel.y * count
        totalSpikes += count
    }

    if (totalSpikes === 0) return { active: false, x: null, y: null, totalSpikes: 0 }

    return {
        active: true,
        x: round(weightedX / totalSpikes, 3),
        y: round(weightedY / totalSpikes, 3),
        totalSpikes,
    }
}

function computePopulationActivity(spikeCounts: Uint16Array, windowMs: number) {
    const seconds = windowMs / 1000
    let activeChannels = 0
    let totalSpikes = 0

    for (const count of spikeCounts) {
        if (count > 0) activeChannels += 1
        totalSpikes += count
    }

    return {
        activeChannels,
        totalSpikes,
        populationRateHz: round(totalSpikes / seconds, 3),
    }
}

function maxRate(rates: Float32Array) {
    let value = 0
    for (const rate of rates) value = Math.max(value, rate)
    return value
}

function splitCountsByMea(spikeCounts: Uint16Array) {
    return [0, 1, 2, 3].map((meaIndex) =>
        spikeCounts.slice(meaIndex * CHANNELS_PER_MEA, meaIndex * CHANNELS_PER_MEA + CHANNELS_PER_MEA)
    )
}

function channelTraceFromFrame(frame: Frame, absoluteChannel: number) {
    const meaId = Math.floor(absoluteChannel / CHANNELS_PER_MEA) + 1
    const localChannel = absoluteChannel % CHANNELS_PER_MEA
    const mea = frame.meas.find((sample) => sample.meaId === meaId)
    if (!mea) return null
    return mea.data.subarray(localChannel * SAMPLE_COUNT, localChannel * SAMPLE_COUNT + SAMPLE_COUNT)
}

function findMostActiveChannel(counts: Uint16Array) {
    let bestIndex = 0
    let bestCount = -1
    for (let index = 0; index < counts.length; index += 1) {
        if (counts[index] > bestCount) {
            bestCount = counts[index]
            bestIndex = index
        }
    }
    return bestIndex
}

function mapChannel(absoluteIndex: number) {
    const meaIndex = Math.floor(absoluteIndex / CHANNELS_PER_MEA)
    const localIndex = absoluteIndex % CHANNELS_PER_MEA
    const biochipIndex = Math.floor(localIndex / 8)
    const electrodeInBiochip = localIndex % 8
    const chipColumn = biochipIndex % 2
    const chipRow = Math.floor(biochipIndex / 2)
    const electrodeColumn = electrodeInBiochip % 4
    const electrodeRow = Math.floor(electrodeInBiochip / 4)

    return {
        absoluteIndex,
        meaId: meaIndex + 1,
        localIndex,
        biochipIndex,
        electrodeInBiochip,
        x: chipColumn * 4 + electrodeColumn,
        y: chipRow * 2 + electrodeRow,
    }
}

function channelsForMea(meaId: number) {
    const start = (meaId - 1) * CHANNELS_PER_MEA
    return Array.from({ length: CHANNELS_PER_MEA }, (_, offset) => mapChannel(start + offset))
}

function formatChannelLabel(channel: ReturnType<typeof mapChannel>, useAbsoluteIndex: boolean) {
    return String(useAbsoluteIndex ? channel.absoluteIndex : channel.localIndex).padStart(2, "0")
}

function summarizeNoiseBand(trace: Float32Array) {
    const values = Array.from(trace).filter(Number.isFinite).sort((a, b) => a - b)
    if (values.length === 0) return { centerUv: 0, madUv: 0, noiseFloorUv: 0 }
    const center = median(values)
    const deviations = values.map((value) => Math.abs(value - center)).sort((a, b) => a - b)
    const mad = median(deviations)
    return {
        centerUv: round(center, 3),
        madUv: round(mad, 3),
        noiseFloorUv: round(1.4826 * mad, 3),
    }
}

function decodeReplay(payload: any): Frame {
    const sampleEntries = payload?.samples ? Object.values(payload.samples) : []
    if (!Array.isArray(sampleEntries) || sampleEntries.length === 0) {
        throw new Error("Replay file does not contain captured MEA samples.")
    }

    const meas = sampleEntries
        .map((sample: any) => ({
            meaId: Number(sample.meaId),
            data: decodeBase64Float32(String(sample.base64Float32LE || "")),
        }))
        .filter((sample) => Number.isInteger(sample.meaId) && sample.data.length === CHANNELS_PER_MEA * SAMPLE_COUNT)
        .sort((a, b) => a.meaId - b.meaId)

    if (meas.length === 0) throw new Error("Replay file has no decodable MEA frames.")

    return {
        source: "replay",
        timestamp: payload?.capturedAt ? new Date(payload.capturedAt) : new Date(),
        sampleRateHz: Number(payload?.sampleRateHz) || SAMPLE_RATE_HZ,
        sampleWindowMs: Number(payload?.sampleWindowMs) || SAMPLE_WINDOW_MS,
        meas,
    }
}

function decodeBase64Float32(base64: string) {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
    }
    return new Float32Array(bytes.buffer)
}

function makeDemoMea(meaId: number, phase: number, random: () => number) {
    const data = new Float32Array(CHANNELS_PER_MEA * SAMPLE_COUNT)
    const burstCenter = (phase * 257 + meaId * 431) % SAMPLE_COUNT
    const activeBiochip = (phase + meaId) % 4

    for (let channel = 0; channel < CHANNELS_PER_MEA; channel += 1) {
        const channelOffset = channel * SAMPLE_COUNT
        const chip = Math.floor(channel / 8)
        const channelGain = chip === activeBiochip ? 1.5 : 0.7
        const baseNoise = 3 + meaId * 0.6 + (channel % 4) * 0.35

        for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
            data[channelOffset + sample] = gaussian(random) * baseNoise
        }

        if ((channel + phase + meaId) % 5 === 0 || chip === activeBiochip) {
            for (let pulse = 0; pulse < 3; pulse += 1) {
                const center = (burstCenter + pulse * 180 + channel * 13) % SAMPLE_COUNT
                drawSpikeWaveform(data, channelOffset, center, channelGain * (45 + random() * 80))
            }
        }
    }

    return data
}

function drawSpikeWaveform(data: Float32Array, channelOffset: number, center: number, amplitude: number) {
    const shape = [-0.1, -0.35, -0.8, -1, -0.6, 0.35, 0.18, 0.05]
    for (let index = 0; index < shape.length; index += 1) {
        const sample = center + index - 3
        if (sample >= 0 && sample < SAMPLE_COUNT) data[channelOffset + sample] += shape[index] * amplitude
    }
}

function gaussian(random: () => number) {
    return random() + random() + random() + random() - 2
}

function mulberry32(seed: number) {
    return function next() {
        let t = (seed += 0x6d2b79f5)
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function drawRaster(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    events: RasterEvent[],
    windowMs: number,
    absoluteLabels: boolean
) {
    const nowMs = performance.now()
    clearChart(ctx, width, height)
    const left = 68
    const right = 12
    const top = 12
    const bottom = 12
    const plotWidth = Math.max(1, width - left - right)
    const plotHeight = Math.max(1, height - top - bottom)
    const rowHeight = plotHeight / CHANNEL_COUNT

    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    ctx.textAlign = "right"
    ctx.textBaseline = "middle"
    ctx.fillStyle = "#68726a"

    for (let meaId = 1; meaId <= MEA_COUNT; meaId += 1) {
        const channel = (meaId - 1) * CHANNELS_PER_MEA
        const y = top + channel * rowHeight
        ctx.strokeStyle = COLORS.lineStrong
        ctx.beginPath()
        ctx.moveTo(left, y)
        ctx.lineTo(width - right, y)
        ctx.stroke()
        ctx.textAlign = "left"
        ctx.fillStyle = meaAccent(meaId)
        ctx.fillText(`MEA ${meaId}`, 10, y + rowHeight * 2)
        ctx.textAlign = "right"
        ctx.fillStyle = COLORS.muted
    }

    for (let channel = 0; channel < CHANNEL_COUNT; channel += 8) {
        const y = top + channel * rowHeight
        ctx.strokeStyle = channel % CHANNELS_PER_MEA === 0 ? "#cbd7e4" : "#edf2f7"
        ctx.beginPath()
        ctx.moveTo(left, y)
        ctx.lineTo(width - right, y)
        ctx.stroke()
        const label = absoluteLabels ? channel : channel % CHANNELS_PER_MEA
        ctx.fillText(String(label).padStart(2, "0"), left - 8, y + rowHeight * 4)
    }

    const drawableEvents = capDrawableEvents(events, Math.max(1400, Math.floor(width * 8)))
    for (const event of drawableEvents) {
        const age = nowMs - event.absoluteTimeMs
        if (age < 0 || age > windowMs) continue
        const x = left + plotWidth * (1 - age / windowMs)
        const y = top + event.absoluteChannel * rowHeight + rowHeight / 2
        const meaId = Math.floor(event.absoluteChannel / CHANNELS_PER_MEA) + 1
        ctx.fillStyle = meaAccent(meaId)
        ctx.globalAlpha = Math.max(0.22, 1 - age / windowMs)
        ctx.fillRect(x, y - Math.max(1, rowHeight * 0.4), 2, Math.max(2, rowHeight * 0.8))
    }
    ctx.globalAlpha = 1
}

function capDrawableEvents<T>(events: T[], maxEvents: number) {
    if (events.length <= maxEvents) return events
    const stride = Math.ceil(events.length / maxEvents)
    const capped: T[] = []
    for (let index = events.length - 1; index >= 0 && capped.length < maxEvents; index -= stride) {
        capped.push(events[index])
    }
    capped.reverse()
    return capped
}

type MeaPanelLayout = {
    columns: number
    gap: number
    header: number
    panelWidth: number
    panelHeight: number
}

function getMeaPanelLayout(width: number, height: number): MeaPanelLayout {
    const compact = width < 560
    const columns = compact ? 2 : 4
    const gap = compact ? 14 : 18
    const header = 12
    const bottom = 12
    const rows = Math.ceil(MEA_COUNT / columns)
    const panelWidth = Math.max(1, (width - gap * (columns + 1)) / columns)
    const panelHeight = Math.max(1, (height - header - bottom - gap * (rows - 1)) / rows)

    return { columns, gap, header, panelWidth, panelHeight }
}

function getMeaPanelPosition(layout: MeaPanelLayout, meaId: number) {
    const index = meaId - 1
    const col = index % layout.columns
    const row = Math.floor(index / layout.columns)

    return {
        x: layout.gap + col * (layout.panelWidth + layout.gap),
        y: layout.header + row * (layout.panelHeight + layout.gap),
    }
}

function drawHeatMap(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    rates: Float32Array,
    absoluteLabels: boolean,
    scaleMaxHz: number
) {
    clearChart(ctx, width, height)
    const layout = getMeaPanelLayout(width, height)
    const heatmapScaleHz = Math.max(1, scaleMaxHz)

    for (let meaId = 1; meaId <= MEA_COUNT; meaId += 1) {
        const { x: x0, y: y0 } = getMeaPanelPosition(layout, meaId)
        const cellWidth = layout.panelWidth / 8
        const cellHeight = layout.panelHeight / 4

        for (const channel of channelsForMea(meaId)) {
            const rate = rates[channel.absoluteIndex] || 0
            const intensity = Math.min(1, rate / heatmapScaleHz)
            const x = x0 + channel.x * cellWidth
            const y = y0 + channel.y * cellHeight
            ctx.fillStyle = mixColor("#ecf6ff", meaAccent(meaId), intensity)
            ctx.fillRect(x + 1, y + 1, Math.max(1, cellWidth - 2), Math.max(1, cellHeight - 2))
            const canShowLabel = absoluteLabels ? cellWidth >= 23 && cellHeight >= 18 : cellWidth >= 15 && cellHeight >= 16
            if (canShowLabel) {
                ctx.fillStyle = intensity > 0.62 ? "#ffffff" : "#233025"
                ctx.font = `${cellWidth < 18 ? 9 : 10}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
                ctx.textAlign = "center"
                ctx.textBaseline = "middle"
                ctx.fillText(formatChannelLabel(channel, absoluteLabels), x + cellWidth / 2, y + cellHeight / 2)
            }
        }

        ctx.strokeStyle = "#d7dee7"
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, layout.panelWidth - 1, layout.panelHeight - 1)
        ctx.fillStyle = "#1f261f"
        ctx.textAlign = "left"
        ctx.textBaseline = "alphabetic"
        ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        ctx.fillText(`MEA ${meaId}`, x0 + 6, y0 + 14)
    }
}

function drawTimeline(ctx: CanvasRenderingContext2D, width: number, height: number, timeline: TimelinePoint[]) {
    clearChart(ctx, width, height)
    const left = 54
    const right = 12
    const top = 18
    const bottom = 24
    const plotWidth = width - left - right
    const plotHeight = height - top - bottom
    const maxRate = Math.max(1, ...timeline.map((point) => point.populationRateHz))

    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 1
    for (let index = 0; index <= 4; index += 1) {
        const y = top + (plotHeight * index) / 4
        ctx.beginPath()
        ctx.moveTo(left, y)
        ctx.lineTo(width - right, y)
        ctx.stroke()
    }

    ctx.strokeStyle = COLORS.line
    ctx.beginPath()
    ctx.moveTo(left, top)
    ctx.lineTo(left, top + plotHeight)
    ctx.lineTo(width - right, top + plotHeight)
    ctx.stroke()

    ctx.fillStyle = COLORS.muted
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    ctx.textAlign = "right"
    ctx.textBaseline = "middle"
    ctx.fillText("0", left - 8, top + plotHeight)

    if (timeline.length < 2) return

    ctx.beginPath()
    timeline.forEach((point, index) => {
        const x = left + (plotWidth * index) / Math.max(1, timeline.length - 1)
        const y = top + plotHeight - (point.populationRateHz / maxRate) * plotHeight
        if (index === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
    })
    ctx.strokeStyle = COLORS.brand
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.lineWidth = 1
}

function drawCenterOfActivity(ctx: CanvasRenderingContext2D, width: number, height: number, centers: Center[]) {
    clearChart(ctx, width, height)
    const layout = getMeaPanelLayout(width, height)

    for (let meaId = 1; meaId <= MEA_COUNT; meaId += 1) {
        const center = centers[meaId - 1]
        const { x: x0, y: y0 } = getMeaPanelPosition(layout, meaId)
        ctx.strokeStyle = "#d7dee7"
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, layout.panelWidth - 1, layout.panelHeight - 1)
        ctx.strokeStyle = "#edf2f7"
        for (let col = 1; col < 8; col += 1) {
            const x = x0 + (layout.panelWidth * col) / 8
            ctx.beginPath()
            ctx.moveTo(x, y0)
            ctx.lineTo(x, y0 + layout.panelHeight)
            ctx.stroke()
        }
        for (let row = 1; row < 4; row += 1) {
            const y = y0 + (layout.panelHeight * row) / 4
            ctx.beginPath()
            ctx.moveTo(x0, y)
            ctx.lineTo(x0 + layout.panelWidth, y)
            ctx.stroke()
        }
        ctx.fillStyle = meaAccent(meaId)
        ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        ctx.fillText(`MEA ${meaId}`, x0 + 6, y0 + 14)

        if (!center?.active) {
            ctx.fillStyle = "#7a867d"
            ctx.fillText(layout.panelWidth < 96 ? "0" : "quiet", x0 + 6, y0 + layout.panelHeight - 8)
            continue
        }

        const x = x0 + ((center.x! + 0.5) / 8) * layout.panelWidth
        const y = y0 + ((center.y! + 0.5) / 4) * layout.panelHeight
        ctx.fillStyle = meaAccent(meaId)
        ctx.beginPath()
        ctx.arc(x, y, 7, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = "#fffef7"
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.lineWidth = 1
        ctx.fillStyle = "#1f261f"
        ctx.fillText(layout.panelWidth < 118 ? String(center.totalSpikes) : `${center.totalSpikes} crossings`, x0 + 6, y0 + layout.panelHeight - 8)
    }
}

function drawSignal(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    trace: Float32Array | null,
    thresholdUv: number,
    rangeUv: number
) {
    clearChart(ctx, width, height)
    const left = 38
    const right = 12
    const top = 18
    const bottom = 12
    const plotWidth = width - left - right
    const plotHeight = height - top - bottom
    const centerY = top + plotHeight / 2
    const scale = plotHeight / 2 / rangeUv
    const band = Math.min(plotHeight / 2, thresholdUv * scale)

    ctx.fillStyle = "#eaf6ff"
    ctx.fillRect(left, centerY - band, plotWidth, band * 2)
    ctx.strokeStyle = "#c54e33"
    ctx.setLineDash([4, 4])
    for (const sign of [-1, 1]) {
        const y = Math.max(top, Math.min(top + plotHeight, centerY - sign * thresholdUv * scale))
        ctx.beginPath()
        ctx.moveTo(left, y)
        ctx.lineTo(width - right, y)
        ctx.stroke()
    }
    ctx.setLineDash([])

    if (trace) {
        ctx.beginPath()
        const step = Math.max(1, Math.floor(trace.length / plotWidth))
        let x = left
        for (let index = 0; index < trace.length; index += step) {
            const value = Math.max(-rangeUv, Math.min(rangeUv, trace[index]))
            const y = centerY - value * scale
            if (index === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
            x += 1
        }
        ctx.strokeStyle = "#202722"
        ctx.lineWidth = 1.35
        ctx.stroke()
        ctx.lineWidth = 1
    }
}

function clearChart(ctx: CanvasRenderingContext2D, width: number, height: number) {
    ctx.fillStyle = COLORS.chartPaper
    ctx.fillRect(0, 0, width, height)
    ctx.strokeStyle = COLORS.line
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1)
}

function meaAccent(meaId: number) {
    return MEA_COLORS[meaId - 1] ?? COLORS.brand
}

function mixColor(from: string, to: string, amount: number) {
    const start = hexToRgb(from)
    const end = hexToRgb(to)
    const mix = {
        r: Math.round(start.r + (end.r - start.r) * amount),
        g: Math.round(start.g + (end.g - start.g) * amount),
        b: Math.round(start.b + (end.b - start.b) * amount),
    }
    return `rgb(${mix.r}, ${mix.g}, ${mix.b})`
}

function hexToRgb(hex: string) {
    const clean = hex.replace("#", "")
    return {
        r: parseInt(clean.slice(0, 2), 16),
        g: parseInt(clean.slice(2, 4), 16),
        b: parseInt(clean.slice(4, 6), 16),
    }
}

function median(sortedValues: number[]) {
    const middle = Math.floor(sortedValues.length / 2)
    if (sortedValues.length % 2 === 1) return sortedValues[middle]
    return (sortedValues[middle - 1] + sortedValues[middle]) / 2
}

function round(value: number, digits: number) {
    const factor = 10 ** digits
    return Math.round(value * factor) / factor
}

function makeStatus(level: StatusLevel, message: string): StatusEntry {
    return { level, message, at: new Date() }
}

function normalizeSource(value: SourceMode): SourceMode {
    return SOURCE_MODES.has(value) ? value : "live"
}

function normalizeThreshold(value: number) {
    return normalizeSteppedNumber(value, 80, 20, 260, 5)
}

function normalizeVoltageRange(value: number) {
    return VOLTAGE_RANGES.includes(value as (typeof VOLTAGE_RANGES)[number]) ? value : 160
}

function getInitialUrlSource(fallback: SourceMode): SourceMode {
    if (typeof window === "undefined") return fallback
    const value = new URLSearchParams(window.location.search).get("source")
    return SOURCE_MODES.has(value as SourceMode) ? (value as SourceMode) : normalizeSource(fallback)
}

function getInitialUrlNumber(
    key: string,
    fallback: number,
    min: number,
    max: number,
    step: number
) {
    if (typeof window === "undefined") return fallback
    const raw = new URLSearchParams(window.location.search).get(key)
    if (raw === null || raw.trim() === "") return fallback
    const value = Number(raw)
    return normalizeSteppedNumber(value, fallback, min, max, step)
}

function getInitialUrlRange(fallback: number) {
    if (typeof window === "undefined") return fallback
    const value = Number(new URLSearchParams(window.location.search).get("range"))
    return VOLTAGE_RANGES.includes(value as (typeof VOLTAGE_RANGES)[number])
        ? value
        : normalizeVoltageRange(fallback)
}

function getInitialUrlLabels(fallback: boolean) {
    if (typeof window === "undefined") return fallback
    const value = new URLSearchParams(window.location.search).get("labels")
    if (value === "absolute") return true
    if (value === "local") return false
    return fallback
}

function normalizeSteppedNumber(
    value: number,
    fallback: number,
    min: number,
    max: number,
    step: number
) {
    const numericValue = Number(value)
    const numericFallback = Number(fallback)
    const safeValue = Number.isFinite(numericValue) ? numericValue : numericFallback
    return Math.max(min, Math.min(max, Math.round(safeValue / step) * step))
}

function formatFrameAge(deltaMs: number) {
    const seconds = Math.max(0, deltaMs / 1000)
    return seconds < 9.95 ? `${seconds.toFixed(1)}s ago` : `${Math.round(seconds)}s ago`
}

function resolveReplayUrl(replayFile: Props["replayFile"], replayUrl?: string) {
    if (typeof replayFile === "string") return replayFile
    if (replayFile?.url) return replayFile.url
    return replayUrl?.trim() || null
}

function updateDocumentMetadata(title: string, description: string) {
    if (typeof document === "undefined") return

    document.title = title
    setMetaTag("name", "description", description)
    setMetaTag("property", "og:title", title)
    setMetaTag("property", "og:description", description)
}

function setMetaTag(attribute: "name" | "property", key: string, content: string) {
    if (typeof document === "undefined") return
    const selector = `meta[${attribute}="${key}"]`
    let element = document.querySelector<HTMLMetaElement>(selector)
    if (!element) {
        element = document.createElement("meta")
        element.setAttribute(attribute, key)
        document.head.appendChild(element)
    }
    element.content = content
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

function installStyles() {
    if (typeof document === "undefined") return
    if (document.getElementById("finalspark-live-viz-styles")) return

    const style = document.createElement("style")
    style.id = "finalspark-live-viz-styles"
    style.textContent = styles
    document.head.appendChild(style)
}

const styles = `
.fs-viz {
    --fs-ink: #202722;
    --fs-muted: #68717a;
    --fs-paper: #eef5fb;
    --fs-surface: #fffef7;
    --fs-line: #d7dee7;
    --fs-line-strong: #aebcca;
    --fs-brand: #2ea3f2;
    --fs-brand-dark: #0879ca;
    --fs-brand-soft: #eaf6ff;
    --fs-rust: #bb4b36;
    --fs-amber: #a46221;
    width: 100%;
    min-width: 320px;
    scroll-margin-top: 16px;
    color: var(--fs-ink);
    font-family: -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif;
    letter-spacing: 0;
    touch-action: manipulation;
}
.fs-viz * {
    box-sizing: border-box;
}
.fs-viz button,
.fs-viz input,
.fs-viz select {
    font: inherit;
}
.fs-viz button:focus-visible,
.fs-viz input:focus-visible,
.fs-viz select:focus-visible,
.fs-viz summary:focus-visible {
    outline: 2px solid rgba(46, 163, 242, 0.35);
    outline-offset: 2px;
}
.fs-viz__shell {
    overflow: hidden;
    border: 1px solid var(--fs-line);
    border-radius: 12px;
    background:
        radial-gradient(circle at 86% -120px, rgba(235, 104, 23, 0.24) 0, rgba(235, 104, 23, 0) 310px),
        linear-gradient(180deg, #061527 0, #073763 95px, #0b74bf 190px, #eef5fb 350px, #f7f9fb 100%);
}
.fs-viz__header {
    display: flex;
    align-items: center;
    min-height: 86px;
    padding: 14px 26px;
    border-bottom: 1px solid color-mix(in srgb, var(--fs-brand), #ffffff 68%);
    background: linear-gradient(112deg, #061527 0%, #073763 42%, #0b74bf 76%, #eb6817 155%);
    color: #ffffff;
}
.fs-viz__brand {
    display: flex;
    align-items: center;
    gap: 18px;
    min-width: 0;
}
.fs-viz__logo {
    display: block;
    flex: 0 0 auto;
    width: clamp(142px, 13vw, 184px);
    height: auto;
}
.fs-viz__brand .fs-viz__intro {
    padding-left: 18px;
    border-left: 1px solid rgba(255, 255, 255, 0.28);
}
.fs-viz__intro {
    display: grid;
    gap: 4px;
    min-width: 0;
}
.fs-viz__eyebrow {
    margin: 0;
    color: var(--fs-brand);
    font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    text-transform: uppercase;
}
.fs-viz h1,
.fs-viz h2,
.fs-viz p {
    margin: 0;
}
.fs-viz h1 {
    max-width: 540px;
    color: #ffffff;
    font-size: 22px;
    font-weight: 750;
    line-height: 1.12;
    letter-spacing: 0;
    text-wrap: balance;
}
.fs-viz__subtitle {
    max-width: 760px;
    color: rgba(255, 255, 255, 0.78);
    font-size: 13px;
    line-height: 1.35;
}
.fs-viz__status {
    display: grid;
    gap: 5px;
    min-height: 0;
    padding: 12px;
    border: 1px solid rgba(131, 198, 244, 0.72);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.1);
}
.fs-viz__status > span,
.fs-viz__metric span,
.fs-viz__control span,
.fs-viz__select span,
.fs-viz__toggle span {
    color: var(--fs-muted);
    font-size: 12px;
}
.fs-viz__toolbar .fs-viz__control span,
.fs-viz__toolbar .fs-viz__select span,
.fs-viz__toolbar .fs-viz__toggle span,
.fs-viz__toolbar .fs-viz__status > span {
    color: rgba(255, 255, 255, 0.76);
}
.fs-viz__status strong {
    color: #ffffff;
    font: 700 13px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    overflow-wrap: anywhere;
}
.fs-viz__freshness {
    display: block;
    color: rgba(255, 255, 255, 0.74);
    font: 700 11px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.fs-viz__status[data-level="ok"] {
    border-color: color-mix(in srgb, var(--fs-brand), var(--fs-line) 58%);
}
.fs-viz__status[data-level="ok"] strong {
    color: var(--fs-brand-dark);
}
.fs-viz__toolbar .fs-viz__status[data-level="ok"] strong {
    color: #5bc6ff;
}
.fs-viz__status[data-level="warn"] {
    border-color: color-mix(in srgb, var(--fs-amber), var(--fs-line) 52%);
}
.fs-viz__status[data-level="warn"] strong {
    color: var(--fs-amber);
}
.fs-viz__toolbar .fs-viz__status[data-level="warn"] strong {
    color: #f5b261;
}
.fs-viz__status[data-level="error"] {
    border-color: color-mix(in srgb, var(--fs-rust), var(--fs-line) 45%);
}
.fs-viz__status[data-level="error"] strong {
    color: var(--fs-rust);
}
.fs-viz__toolbar .fs-viz__status[data-level="error"] strong {
    color: #ff8a72;
}
.fs-viz__status-log {
    margin-top: 3px;
}
.fs-viz__status-log summary {
    cursor: pointer;
    color: rgba(255, 255, 255, 0.74);
    font: 700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.fs-viz__status-log div {
    display: grid;
    gap: 4px;
    max-height: 72px;
    margin-top: 6px;
    padding-top: 6px;
    overflow: auto;
    border-top: 1px solid rgba(255, 255, 255, 0.18);
    font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.fs-viz__status-log span {
    color: var(--fs-muted);
}
.fs-viz__status-log span[data-level="error"] {
    color: var(--fs-rust);
}
.fs-viz__status-log span[data-level="warn"] {
    color: var(--fs-amber);
}
.fs-viz__status-log span[data-level="ok"] {
    color: var(--fs-brand-dark);
}
.fs-viz__toolbar {
    display: grid;
    grid-template-columns: minmax(200px, 0.5fr) minmax(420px, 1.2fr) auto auto minmax(300px, 0.85fr);
    gap: 10px;
    align-items: center;
    margin: 12px 26px 14px;
    padding: 12px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 8px;
    background: rgba(6, 21, 39, 0.72);
    box-shadow: 0 18px 42px rgba(3, 20, 38, 0.24);
    color: #ffffff;
    backdrop-filter: blur(12px);
}
.fs-viz__segmented {
    display: inline-grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.38);
    border-radius: 10px;
    width: 100%;
}
.fs-viz__segmented button,
.fs-viz__button {
    min-height: 38px;
    border: 0;
    background: rgba(255, 253, 245, 0.94);
    color: var(--fs-ink);
    cursor: pointer;
}
.fs-viz__segmented button {
    border-right: 1px solid rgba(255, 255, 255, 0.28);
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
}
.fs-viz__segmented button:last-child {
    border-right: 0;
}
.fs-viz__segmented button[data-active="true"] {
    background: var(--fs-brand-dark);
    color: #ffffff;
}
.fs-viz__segmented button:hover,
.fs-viz__button:hover {
    background: var(--fs-brand-soft);
}
.fs-viz__segmented button[data-active="true"]:hover {
    background: var(--fs-brand-dark);
}
.fs-viz__control,
.fs-viz__select,
.fs-viz__toggle {
    display: grid;
    gap: 6px;
}
.fs-viz__controls-drawer {
    min-width: 0;
}
.fs-viz__controls-drawer summary {
    display: none;
}
.fs-viz__controls-body {
    display: grid;
    grid-template-columns: minmax(190px, 1fr) minmax(140px, 0.42fr) auto;
    gap: 12px;
    align-items: center;
}
.fs-viz__control {
    grid-template-columns: auto minmax(120px, 1fr) auto;
    align-items: center;
}
.fs-viz__control span {
    grid-column: 1 / -1;
}
.fs-viz__control input {
    width: 100%;
    accent-color: var(--fs-brand);
}
.fs-viz__control strong {
    color: var(--fs-ink);
    font: 700 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.fs-viz__select select {
    min-height: 38px;
    border: 1px solid rgba(255, 255, 255, 0.48);
    border-radius: 8px;
    background: rgba(255, 253, 245, 0.94);
    color: var(--fs-ink);
}
.fs-viz__toggle {
    grid-auto-flow: column;
    align-items: center;
    justify-content: start;
    white-space: nowrap;
}
.fs-viz__toggle input {
    accent-color: var(--fs-brand);
}
.fs-viz__button {
    padding: 0 14px;
    border: 1px solid rgba(255, 255, 255, 0.48);
    border-radius: 8px;
}
.fs-viz__metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
    padding: 0 26px 10px;
    background: transparent;
}
.fs-viz__metric {
    min-height: 68px;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--fs-brand), var(--fs-line) 72%);
    border-radius: 8px;
    background: var(--fs-surface);
    min-width: 0;
    box-shadow: 0 10px 28px rgba(7, 55, 99, 0.08);
}
.fs-viz__metric strong {
    display: block;
    margin-top: 8px;
    color: var(--fs-ink);
    font: 700 18px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
}
.fs-viz__metric--sample {
    min-width: 190px;
}
.fs-viz__sample-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
}
.fs-viz__sample-badges strong {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    margin: 0;
    padding: 4px 7px;
    border: 1px solid color-mix(in srgb, var(--fs-brand), var(--fs-line) 60%);
    border-radius: 999px;
    background: var(--fs-brand-soft);
    color: var(--fs-brand-dark);
    font: 700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.fs-viz__mea-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    padding: 0 26px 12px;
    background: transparent;
}
.fs-viz__mea-stat {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 8px;
    align-items: baseline;
    min-height: 56px;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--fs-brand), var(--fs-line) 72%);
    border-radius: 8px;
    background: var(--fs-surface);
    box-shadow: 0 10px 28px rgba(7, 55, 99, 0.08);
}
.fs-viz__mea-stat strong {
    color: var(--fs-ink);
    font-size: 12px;
}
.fs-viz__mea-stat span {
    color: var(--fs-ink);
    font: 700 18px/1.1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    text-align: right;
    font-variant-numeric: tabular-nums;
}
.fs-viz__mea-stat small {
    color: var(--fs-muted);
    font-size: 12px;
    text-align: right;
}
.fs-viz__grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
    padding: 0 26px 26px;
    background: transparent;
}
.fs-viz__panel {
    min-width: 0;
    padding: 14px;
    border: 1px solid color-mix(in srgb, var(--fs-brand), var(--fs-line) 76%);
    border-radius: 8px;
    background: var(--fs-surface);
    box-shadow: 0 14px 34px rgba(7, 55, 99, 0.08);
}
.fs-viz__panel--wide {
    grid-column: 1 / -1;
}
.fs-viz__panel-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 10px;
}
.fs-viz__panel-head > div {
    min-width: 0;
}
.fs-viz__panel h2 {
    color: var(--fs-ink);
    font-size: 17px;
    line-height: 1.2;
    letter-spacing: 0;
}
.fs-viz__panel-head p {
    max-width: 380px;
    margin-top: 4px;
    color: var(--fs-muted);
    font-size: 13px;
    line-height: 1.35;
    text-align: left;
}
.fs-viz__panel-meta {
    flex: 0 0 auto;
    max-width: 230px;
    padding: 5px 7px;
    border: 1px solid color-mix(in srgb, var(--fs-brand), var(--fs-line) 62%);
    border-radius: 999px;
    background: var(--fs-brand-soft);
    color: var(--fs-brand-dark);
    font: 700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    text-align: right;
    overflow-wrap: anywhere;
}
.fs-viz__canvas {
    display: block;
    width: 100%;
    min-height: 180px;
    border-radius: 4px;
}
.fs-viz__canvas--raster {
    height: 430px;
}
.fs-viz__canvas--medium {
    height: 260px;
}
.fs-viz__canvas--heatmap {
    height: 320px;
}
.fs-viz__canvas--center {
    height: 270px;
}
.fs-viz__heatmap-legend {
    display: grid;
    grid-template-columns: auto minmax(120px, 1fr) auto;
    gap: 10px;
    align-items: center;
    margin-top: 8px;
    color: var(--fs-muted);
    font: 700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.fs-viz__heatmap-ramp {
    height: 10px;
    border: 1px solid var(--fs-line-strong);
    border-radius: 999px;
    background: linear-gradient(90deg, #ecf6ff 0%, var(--fs-brand) 52%, #eb6817 100%);
}
.fs-viz__chart-summary {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}
.fs-viz__footer {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px;
    padding: 0 26px 26px;
    color: var(--fs-muted);
    font-size: 13px;
    line-height: 1.45;
    background: transparent;
}
.fs-viz__help {
    grid-column: 1 / -1;
    border: 1px solid var(--fs-line);
    border-radius: 8px;
    background: var(--fs-surface);
}
.fs-viz__help summary {
    display: flex;
    gap: 14px;
    align-items: baseline;
    justify-content: space-between;
    padding: 12px 14px;
    cursor: pointer;
    list-style: none;
}
.fs-viz__help summary::-webkit-details-marker {
    display: none;
}
.fs-viz__help summary::after {
    content: "Open";
    flex: 0 0 auto;
    color: var(--fs-brand-dark);
    font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.fs-viz__help[open] summary::after {
    content: "Close";
}
.fs-viz__help summary span {
    font-weight: 700;
}
.fs-viz__help summary small {
    color: var(--fs-muted);
    font-size: 12px;
    line-height: 1.35;
}
.fs-viz__help dl {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 10px;
    margin: 0;
    padding: 0 14px 12px;
}
.fs-viz__help dl div {
    display: grid;
    gap: 5px;
    padding-top: 10px;
    border-top: 1px solid var(--fs-line);
}
.fs-viz__help dt {
    color: var(--fs-brand-dark);
    font-weight: 700;
}
.fs-viz__help dd {
    margin: 0;
    color: var(--fs-muted);
    font-size: 13px;
    line-height: 1.4;
}
.fs-viz__help p {
    margin: 0 14px 14px;
    padding-top: 10px;
    border-top: 1px dashed var(--fs-line-strong);
    color: var(--fs-muted);
    font-size: 13px;
    line-height: 1.45;
}
@media (max-width: 980px) {
    .fs-viz__grid,
    .fs-viz__footer {
        grid-template-columns: 1fr;
    }
    .fs-viz__header,
    .fs-viz__mea-strip,
    .fs-viz__metrics,
    .fs-viz__grid,
    .fs-viz__footer {
        padding-left: 18px;
        padding-right: 18px;
    }
    .fs-viz h1 {
        font-size: 22px;
        line-height: 1.2;
    }
    .fs-viz__toolbar {
        grid-template-columns: minmax(180px, 0.52fr) minmax(0, 1fr) auto auto;
    }
    .fs-viz__status {
        grid-column: 1 / -1;
    }
    .fs-viz__panel-head {
        display: grid;
    }
    .fs-viz__panel-head p {
        text-align: left;
    }
}
@media (max-width: 520px) {
    .fs-viz__shell {
        border-radius: 12px;
    }
    .fs-viz__header {
        min-height: 0;
        padding-top: 14px;
        padding-bottom: 14px;
    }
    .fs-viz__brand {
        display: grid;
        gap: 10px;
    }
    .fs-viz__logo {
        width: 138px;
    }
    .fs-viz__brand .fs-viz__intro {
        padding-left: 0;
        border-left: 0;
    }
    .fs-viz__intro {
        grid-template-columns: 1fr;
        gap: 6px;
    }
    .fs-viz h1 {
        font-size: 20px;
        line-height: 1.16;
    }
    .fs-viz__subtitle {
        font-size: 13px;
        line-height: 1.35;
    }
    .fs-viz__status {
        min-height: 86px;
    }
    .fs-viz__toolbar {
        gap: 10px;
        grid-template-columns: 1fr auto auto;
        margin-left: 18px;
        margin-right: 18px;
    }
    .fs-viz__segmented,
    .fs-viz__controls-drawer {
        grid-column: 1 / -1;
    }
    .fs-viz__controls-drawer {
        border: 1px solid var(--fs-line);
        border-radius: 8px;
        background: var(--fs-surface);
        color: var(--fs-ink);
    }
    .fs-viz__controls-drawer summary {
        display: flex;
        gap: 10px;
        align-items: baseline;
        justify-content: space-between;
        padding: 11px 12px;
        cursor: pointer;
        list-style: none;
    }
    .fs-viz__controls-drawer summary::-webkit-details-marker {
        display: none;
    }
    .fs-viz__controls-drawer summary::after {
        content: "Open";
        flex: 0 0 auto;
        color: var(--fs-brand-dark);
        font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .fs-viz__controls-drawer[open] summary::after {
        content: "Close";
    }
    .fs-viz__controls-drawer summary span {
        color: var(--fs-ink);
        font-weight: 700;
    }
    .fs-viz__controls-drawer summary small {
        color: var(--fs-muted);
        font-size: 12px;
        line-height: 1.3;
        text-align: right;
    }
    .fs-viz__controls-body {
        grid-template-columns: 1fr;
        gap: 10px;
        padding: 0 12px 12px;
        border-top: 1px solid var(--fs-line);
    }
    .fs-viz__controls-drawer .fs-viz__control span,
    .fs-viz__controls-drawer .fs-viz__select span,
    .fs-viz__controls-drawer .fs-viz__toggle span {
        color: var(--fs-muted);
    }
    .fs-viz__metrics {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .fs-viz__mea-strip {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .fs-viz__mea-stat {
        grid-template-columns: 1fr auto;
    }
    .fs-viz__mea-stat small {
        grid-column: 1 / -1;
        text-align: left;
    }
    .fs-viz__metric:first-child {
        grid-column: 1 / -1;
    }
    .fs-viz__control {
        grid-template-columns: 1fr auto;
    }
    .fs-viz__control input {
        grid-column: 1 / -1;
    }
    .fs-viz__segmented {
        width: 100%;
    }
    .fs-viz__panel-head {
        display: grid;
        gap: 8px;
    }
    .fs-viz__panel-meta {
        justify-self: start;
        max-width: 100%;
        text-align: left;
    }
    .fs-viz__help summary {
        display: grid;
        gap: 4px;
    }
    .fs-viz__help summary::after {
        justify-self: start;
    }
    .fs-viz__canvas--raster {
        height: 360px;
    }
    .fs-viz__canvas--medium {
        height: 220px;
    }
    .fs-viz__canvas--heatmap {
        height: 500px;
    }
    .fs-viz__canvas--center {
        height: 420px;
    }
}
`
