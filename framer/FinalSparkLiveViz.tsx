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
    centers: Center[]
    rasterEvents: RasterEvent[]
    timeline: TimelinePoint[]
    selectedTrace: Float32Array | null
    selectedChannel: number
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
const TIMELINE_POINTS = 44
const SOCKET_IO_URL =
    "wss://livemeaservice.finalspark.com/socket.io/?EIO=4&transport=websocket"
const NEUROPLATFORM_IMAGE =
    "https://finalspark.com/wp-content/themes/divi-creative-agency/images/bioprocessor-panel.png"

const SOURCE_LABEL: Record<SourceMode, string> = {
    live: "Live",
    replay: "Replay",
    demo: "Demo",
}

const EMPTY_VIEW_STATE: ViewState = {
    frame: null,
    counts: new Uint16Array(CHANNEL_COUNT),
    rates: new Float32Array(CHANNEL_COUNT),
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
        title = "Live MEA Signal Explorer",
        subtitle = "128-electrode voltage windows decoded into threshold crossings, raster activity, heatmaps, and center-of-activity movement.",
        preferredSource = "live",
        thresholdUv: initialThreshold = 80,
        voltageRangeUv: initialRange = 160,
    } = props

    const isStaticRenderer = useIsStaticRenderer()
    const [source, setSource] = React.useState<SourceMode>(
        isStaticRenderer ? "demo" : preferredSource
    )
    const [thresholdUv, setThresholdUv] = React.useState(initialThreshold)
    const [voltageRangeUv, setVoltageRangeUv] = React.useState(initialRange)
    const [absoluteLabels, setAbsoluteLabels] = React.useState(false)
    const [paused, setPaused] = React.useState(false)
    const [view, setView] = React.useState<ViewState>(EMPTY_VIEW_STATE)

    const pausedRef = React.useRef(false)
    const thresholdRef = React.useRef(initialThreshold)
    const historyRef = React.useRef({
        rasterEvents: [] as RasterEvent[],
        timeline: [] as TimelinePoint[],
    })

    React.useEffect(() => {
        installStyles()
        if (typeof document !== "undefined") {
            document.title = "FinalSpark Live MEA"
        }
    }, [])

    React.useEffect(() => {
        pausedRef.current = paused
    }, [paused])

    React.useEffect(() => {
        thresholdRef.current = thresholdUv
    }, [thresholdUv])

    React.useEffect(() => {
        setThresholdUv(initialThreshold)
    }, [initialThreshold])

    React.useEffect(() => {
        setVoltageRangeUv(initialRange)
    }, [initialRange])

    React.useEffect(() => {
        const replayUrl = resolveReplayUrl(props.replayFile, props.replayUrl)
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
                        : `Starting ${SOURCE_LABEL[source]} source.`
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

        if (isStaticRenderer || source === "demo") {
            cleanup = startDemoSource(onFrame, onStatus)
        } else if (source === "replay") {
            cleanup = startReplaySource(replayUrl, onFrame, onStatus)
        } else {
            cleanup = startLiveSource(onFrame, onStatus)
        }

        return () => {
            stopped = true
            cleanup()
        }
    }, [source, props.replayFile, props.replayUrl, isStaticRenderer])

    const population = computePopulationActivity(
        view.counts,
        view.frame?.sampleWindowMs ?? SAMPLE_WINDOW_MS
    )
    const sampleMeta = view.frame
        ? `${SOURCE_LABEL[view.frame.source]} | ${view.frame.meas.length}/4 MEAs | ${view.frame.timestamp.toLocaleTimeString()}`
        : "Waiting for data"
    const noise = view.selectedTrace ? summarizeNoiseBand(view.selectedTrace) : null
    const selectedChannel = mapChannel(view.selectedChannel)

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
                    <div className="fs-viz__intro">
                        <p className="fs-viz__eyebrow">Public MEA stream</p>
                        <h1>{title}</h1>
                        <p className="fs-viz__subtitle">{subtitle}</p>
                    </div>
                    <div className="fs-viz__header-aside">
                        <div className="fs-viz__status" aria-live="polite">
                            <span>Stream status</span>
                            <strong>{sampleMeta}</strong>
                            <small>{view.status[0]?.message ?? "No socket activity yet."}</small>
                        </div>
                        <figure className="fs-viz__media">
                            <img
                                src={NEUROPLATFORM_IMAGE}
                                alt="FinalSpark bioprocessor visual"
                                loading="lazy"
                            />
                            <figcaption>Neuroplatform context</figcaption>
                        </figure>
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

                    <label className="fs-viz__control">
                        <span>Threshold</span>
                        <input
                            type="range"
                            min={20}
                            max={260}
                            step={5}
                            value={thresholdUv}
                            onChange={(event) => setThresholdUv(Number(event.currentTarget.value))}
                        />
                        <strong>{thresholdUv} uV</strong>
                    </label>

                    <label className="fs-viz__select">
                        <span>Signal range</span>
                        <select
                            value={voltageRangeUv}
                            onChange={(event) => setVoltageRangeUv(Number(event.currentTarget.value))}
                        >
                            {[80, 120, 160, 200, 320].map((value) => (
                                <option key={value} value={value}>
                                    +/-{value} uV
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="fs-viz__toggle">
                        <input
                            type="checkbox"
                            checked={absoluteLabels}
                            onChange={(event) => setAbsoluteLabels(event.currentTarget.checked)}
                        />
                        <span>Absolute channel labels</span>
                    </label>

                    <button type="button" className="fs-viz__button" onClick={() => setPaused(!paused)}>
                        {paused ? "Resume" : "Pause"}
                    </button>
                    <button type="button" className="fs-viz__button" onClick={clearHistory}>
                        Clear
                    </button>
                </div>

                <div className="fs-viz__metrics">
                    <Metric label="Population rate" value={`${population.populationRateHz.toFixed(2)} Hz`} />
                    <Metric label="Active electrodes" value={String(population.activeChannels)} />
                    <Metric label="Threshold crossings" value={String(population.totalSpikes)} />
                    <Metric label="Sample rate" value={`${SAMPLE_RATE_HZ.toFixed(1)} Hz`} />
                    <Metric label="Window" value={`${(SAMPLE_WINDOW_MS / 1000).toFixed(2)} s`} />
                </div>

                <div className="fs-viz__grid">
                    <Panel
                        className="fs-viz__panel--wide"
                        title="Live raster"
                        copy="Rolling threshold crossings across 128 electrodes."
                    >
                        <RasterCanvas
                            events={view.rasterEvents}
                            absoluteLabels={absoluteLabels}
                            windowMs={RASTER_WINDOW_MS}
                        />
                    </Panel>

                    <Panel title="Electrode activity" copy="Per-channel firing rate estimate for the latest window.">
                        <HeatMapCanvas rates={view.rates} absoluteLabels={absoluteLabels} />
                    </Panel>

                    <Panel title="Population timeline" copy="Recent total activity and active electrode count.">
                        <TimelineCanvas timeline={view.timeline} />
                    </Panel>

                    <Panel title="Center of activity" copy="Weighted by threshold crossings per MEA.">
                        <CenterCanvas centers={view.centers} />
                    </Panel>

                    <Panel title="Signal versus threshold" copy="Most active electrode in the latest frame.">
                        <SignalCanvas
                            trace={view.selectedTrace}
                            thresholdUv={thresholdUv}
                            rangeUv={voltageRangeUv}
                        />
                    </Panel>
                </div>

                <footer className="fs-viz__footer">
                    <p>
                        Probe electrode {formatChannelLabel(selectedChannel, absoluteLabels)} on MEA{" "}
                        {selectedChannel.meaId}:{" "}
                        {noise
                            ? `center ${noise.centerUv} uV, noise floor ${noise.noiseFloorUv} uV.`
                            : "waiting for signal statistics."}
                    </p>
                    <div>
                        {view.status.slice(0, 3).map((entry) => (
                            <span key={`${entry.at.toISOString()}-${entry.message}`} data-level={entry.level}>
                                {entry.at.toLocaleTimeString()} - {entry.message}
                            </span>
                        ))}
                    </div>
                </footer>
            </div>
        </section>
    )
}

const defaultProps: Partial<Props> = {
    preferredSource: "live",
    thresholdUv: 80,
    voltageRangeUv: 160,
    title: "FinalSpark Live MEA",
    subtitle:
        "A browser-based view of public multi-electrode-array voltage windows from FinalSpark, rendered with threshold crossings, population activity, and center-of-activity summaries.",
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
        defaultValue: "FinalSpark Live MEA",
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

function Panel({
    title,
    copy,
    children,
    className = "",
}: {
    title: string
    copy: string
    children: React.ReactNode
    className?: string
}) {
    return (
        <article className={`fs-viz__panel ${className}`}>
            <div className="fs-viz__panel-head">
                <h2>{title}</h2>
                <p>{copy}</p>
            </div>
            {children}
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

    return <canvas ref={canvasRef} className="fs-viz__canvas fs-viz__canvas--raster" />
}

function HeatMapCanvas({
    rates,
    absoluteLabels,
}: {
    rates: Float32Array
    absoluteLabels: boolean
}) {
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null)

    React.useEffect(() => {
        return drawResponsiveCanvas(canvasRef.current, (ctx, width, height) => {
            drawHeatMap(ctx, width, height, rates, absoluteLabels)
        })
    }, [rates, absoluteLabels])

    return <canvas ref={canvasRef} className="fs-viz__canvas fs-viz__canvas--medium" />
}

function TimelineCanvas({ timeline }: { timeline: TimelinePoint[] }) {
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null)

    React.useEffect(() => {
        return drawResponsiveCanvas(canvasRef.current, (ctx, width, height) => {
            drawTimeline(ctx, width, height, timeline)
        })
    }, [timeline])

    return <canvas ref={canvasRef} className="fs-viz__canvas fs-viz__canvas--medium" />
}

function CenterCanvas({ centers }: { centers: Center[] }) {
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null)

    React.useEffect(() => {
        return drawResponsiveCanvas(canvasRef.current, (ctx, width, height) => {
            drawCenterOfActivity(ctx, width, height, centers)
        })
    }, [centers])

    return <canvas ref={canvasRef} className="fs-viz__canvas fs-viz__canvas--medium" />
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

    return <canvas ref={canvasRef} className="fs-viz__canvas fs-viz__canvas--medium" />
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
        centers,
        rasterEvents: [...history.rasterEvents],
        timeline: [...history.timeline],
        selectedChannel,
        selectedTrace,
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
    const left = 48
    const right = 12
    const top = 18
    const bottom = 24
    const plotWidth = Math.max(1, width - left - right)
    const plotHeight = Math.max(1, height - top - bottom)
    const rowHeight = plotHeight / CHANNEL_COUNT

    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    ctx.textAlign = "right"
    ctx.textBaseline = "middle"
    ctx.fillStyle = "#68726a"

    for (let channel = 0; channel < CHANNEL_COUNT; channel += 8) {
        const y = top + channel * rowHeight
        ctx.strokeStyle = channel % CHANNELS_PER_MEA === 0 ? "#c8d1c8" : "#edf1eb"
        ctx.beginPath()
        ctx.moveTo(left, y)
        ctx.lineTo(width - right, y)
        ctx.stroke()
        const label = absoluteLabels ? channel : channel % CHANNELS_PER_MEA
        ctx.fillText(String(label).padStart(2, "0"), left - 8, y + rowHeight * 4)
    }

    for (const event of events) {
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

    ctx.textAlign = "left"
    ctx.textBaseline = "alphabetic"
    ctx.fillStyle = "#1f261f"
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    ctx.fillText(`${Math.round(windowMs / 1000)} s rolling raster`, left, height - 8)
}

function drawHeatMap(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    rates: Float32Array,
    absoluteLabels: boolean
) {
    clearChart(ctx, width, height)
    const gap = width < 520 ? 8 : 14
    const header = 22
    const panelWidth = (width - gap * 5) / 4
    const panelHeight = Math.max(80, height - header - gap)
    const maxRate = Math.max(1, ...Array.from(rates))

    ctx.fillStyle = "#1f261f"
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    ctx.fillText("Firing-rate heat map", 14, 16)

    for (let meaId = 1; meaId <= MEA_COUNT; meaId += 1) {
        const x0 = gap + (meaId - 1) * (panelWidth + gap)
        const y0 = header + 4
        const cellWidth = panelWidth / 8
        const cellHeight = panelHeight / 4

        for (const channel of channelsForMea(meaId)) {
            const rate = rates[channel.absoluteIndex] || 0
            const intensity = Math.min(1, rate / maxRate)
            const x = x0 + channel.x * cellWidth
            const y = y0 + channel.y * cellHeight
            ctx.fillStyle = mixColor("#f4f6f0", meaAccent(meaId), intensity)
            ctx.fillRect(x + 1, y + 1, Math.max(1, cellWidth - 2), Math.max(1, cellHeight - 2))
            if (cellWidth > 20 && cellHeight > 16) {
                ctx.fillStyle = intensity > 0.62 ? "#ffffff" : "#233025"
                ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
                ctx.textAlign = "center"
                ctx.textBaseline = "middle"
                ctx.fillText(formatChannelLabel(channel, absoluteLabels), x + cellWidth / 2, y + cellHeight / 2)
            }
        }

        ctx.strokeStyle = "#d5ddd4"
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, panelWidth - 1, panelHeight - 1)
        ctx.fillStyle = "#1f261f"
        ctx.textAlign = "left"
        ctx.textBaseline = "alphabetic"
        ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        ctx.fillText(`MEA ${meaId}`, x0 + 6, y0 + 14)
    }
}

function drawTimeline(ctx: CanvasRenderingContext2D, width: number, height: number, timeline: TimelinePoint[]) {
    clearChart(ctx, width, height)
    const left = 38
    const right = 12
    const top = 22
    const bottom = 26
    const plotWidth = width - left - right
    const plotHeight = height - top - bottom
    const maxRate = Math.max(1, ...timeline.map((point) => point.populationRateHz))

    ctx.fillStyle = "#1f261f"
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    ctx.fillText("Population activity", 14, 16)

    ctx.strokeStyle = "#d5ddd4"
    ctx.beginPath()
    ctx.moveTo(left, top)
    ctx.lineTo(left, top + plotHeight)
    ctx.lineTo(width - right, top + plotHeight)
    ctx.stroke()

    if (timeline.length < 2) return

    ctx.beginPath()
    timeline.forEach((point, index) => {
        const x = left + (plotWidth * index) / Math.max(1, timeline.length - 1)
        const y = top + plotHeight - (point.populationRateHz / maxRate) * plotHeight
        if (index === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
    })
    ctx.strokeStyle = "#1f7a64"
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.lineWidth = 1

    const last = timeline[timeline.length - 1]
    ctx.fillStyle = "#68726a"
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    ctx.fillText(`${last.activeChannels} active electrodes`, left, height - 8)
}

function drawCenterOfActivity(ctx: CanvasRenderingContext2D, width: number, height: number, centers: Center[]) {
    clearChart(ctx, width, height)
    const gap = width < 520 ? 8 : 14
    const header = 22
    const panelWidth = (width - gap * 5) / 4
    const panelHeight = Math.max(80, height - header - gap)

    ctx.fillStyle = "#1f261f"
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    ctx.fillText(width < 520 ? "Center of Activity" : "Center of Activity by MEA", 14, 16)

    for (let meaId = 1; meaId <= MEA_COUNT; meaId += 1) {
        const center = centers[meaId - 1]
        const x0 = gap + (meaId - 1) * (panelWidth + gap)
        const y0 = header + 4
        ctx.strokeStyle = "#d5ddd4"
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, panelWidth - 1, panelHeight - 1)
        ctx.strokeStyle = "#edf1eb"
        for (let col = 1; col < 8; col += 1) {
            const x = x0 + (panelWidth * col) / 8
            ctx.beginPath()
            ctx.moveTo(x, y0)
            ctx.lineTo(x, y0 + panelHeight)
            ctx.stroke()
        }
        for (let row = 1; row < 4; row += 1) {
            const y = y0 + (panelHeight * row) / 4
            ctx.beginPath()
            ctx.moveTo(x0, y)
            ctx.lineTo(x0 + panelWidth, y)
            ctx.stroke()
        }
        ctx.fillStyle = meaAccent(meaId)
        ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        ctx.fillText(`MEA ${meaId}`, x0 + 6, y0 + 14)

        if (!center?.active) {
            ctx.fillStyle = "#7a867d"
            ctx.fillText("quiet", x0 + 6, y0 + panelHeight - 8)
            continue
        }

        const x = x0 + ((center.x! + 0.5) / 8) * panelWidth
        const y = y0 + ((center.y! + 0.5) / 4) * panelHeight
        ctx.fillStyle = meaAccent(meaId)
        ctx.beginPath()
        ctx.arc(x, y, 7, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = "#fffef7"
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.lineWidth = 1
        ctx.fillStyle = "#1f261f"
        ctx.fillText(String(center.totalSpikes), x0 + 6, y0 + panelHeight - 8)
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
    const top = 24
    const bottom = 28
    const plotWidth = width - left - right
    const plotHeight = height - top - bottom
    const centerY = top + plotHeight / 2
    const scale = plotHeight / 2 / rangeUv
    const band = Math.min(plotHeight / 2, thresholdUv * scale)

    ctx.fillStyle = "#eef3ed"
    ctx.fillRect(left, centerY - band, plotWidth, band * 2)
    ctx.strokeStyle = "#c54e33"
    ctx.setLineDash([4, 4])
    for (const sign of [-1, 1]) {
        const y = centerY - sign * thresholdUv * scale
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

    ctx.fillStyle = "#1f261f"
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    ctx.fillText("Signal vs threshold", 14, 16)
    ctx.fillStyle = "#68726a"
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    ctx.fillText(`+/-${thresholdUv} uV`, left, height - 8)
}

function clearChart(ctx: CanvasRenderingContext2D, width: number, height: number) {
    ctx.fillStyle = "#fbfcf7"
    ctx.fillRect(0, 0, width, height)
    ctx.strokeStyle = "#d9e0d8"
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1)
}

function meaAccent(meaId: number) {
    return ["#1f7a64", "#a46221", "#386ca3", "#bb4b36"][meaId - 1] ?? "#1f7a64"
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

function resolveReplayUrl(replayFile: Props["replayFile"], replayUrl?: string) {
    if (typeof replayFile === "string") return replayFile
    if (replayFile?.url) return replayFile.url
    return replayUrl?.trim() || null
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
    width: 100%;
    min-width: 320px;
    padding-top: 78px;
    scroll-margin-top: 78px;
    color: #202722;
    font-family: Avenir Next, Aptos, Segoe UI, system-ui, sans-serif;
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
.fs-viz select:focus-visible {
    outline: 2px solid rgba(31, 122, 100, 0.35);
    outline-offset: 2px;
}
.fs-viz__shell {
    overflow: hidden;
    border: 1px solid #d9e0d8;
    border-radius: 20px;
    background: #f7f9f2;
}
.fs-viz__header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(260px, 360px);
    gap: 24px;
    align-items: end;
    padding: 30px 30px 20px;
    border-bottom: 1px solid #dfe5de;
    background: #fffef7;
}
.fs-viz__eyebrow {
    margin: 0 0 8px;
    color: #1f7a64;
    font: 700 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    text-transform: uppercase;
}
.fs-viz h1,
.fs-viz h2,
.fs-viz p {
    margin: 0;
}
.fs-viz h1 {
    max-width: 820px;
    font-size: 56px;
    line-height: 0.98;
    letter-spacing: 0;
    text-wrap: balance;
}
.fs-viz__subtitle {
    max-width: 820px;
    margin-top: 12px;
    color: #66716b;
    font-size: 16px;
    line-height: 1.5;
}
.fs-viz__header-aside {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 112px;
    gap: 12px;
    align-items: stretch;
}
.fs-viz__status {
    display: grid;
    gap: 6px;
    min-height: 112px;
    padding: 14px;
    border: 1px solid #d9e0d8;
    border-radius: 12px;
    background: #f7f9f2;
}
.fs-viz__status span,
.fs-viz__metric span,
.fs-viz__control span,
.fs-viz__select span,
.fs-viz__toggle span {
    color: #66716b;
    font-size: 12px;
}
.fs-viz__status strong {
    color: #202722;
    font: 700 14px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.fs-viz__status small {
    color: #66716b;
    font-size: 12px;
    line-height: 1.35;
}
.fs-viz__media {
    display: grid;
    place-items: center;
    min-height: 112px;
    margin: 0;
    padding: 10px 8px 8px;
    border: 1px solid #d9e0d8;
    border-radius: 12px;
    background: #eef7f4;
}
.fs-viz__media img {
    width: 82px;
    height: 82px;
    object-fit: contain;
}
.fs-viz__media figcaption {
    color: #66716b;
    font-size: 10px;
    line-height: 1.2;
    text-align: center;
}
.fs-viz__toolbar {
    display: grid;
    grid-template-columns: auto minmax(190px, 1fr) minmax(140px, 0.36fr) auto auto auto;
    gap: 12px;
    align-items: center;
    padding: 16px 30px;
    border-bottom: 1px solid #dfe5de;
    background: #f7f9f2;
}
.fs-viz__segmented {
    display: inline-grid;
    grid-template-columns: repeat(3, minmax(74px, 1fr));
    overflow: hidden;
    border: 1px solid #b8c3b9;
    border-radius: 10px;
}
.fs-viz__segmented button,
.fs-viz__button {
    min-height: 38px;
    border: 0;
    background: #fffef7;
    color: #202722;
    cursor: pointer;
}
.fs-viz__segmented button {
    border-right: 1px solid #b8c3b9;
}
.fs-viz__segmented button:last-child {
    border-right: 0;
}
.fs-viz__segmented button[data-active="true"] {
    background: #202722;
    color: #fffef7;
}
.fs-viz__control,
.fs-viz__select,
.fs-viz__toggle {
    display: grid;
    gap: 6px;
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
    accent-color: #1f7a64;
}
.fs-viz__control strong {
    color: #202722;
    font: 700 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.fs-viz__select select {
    min-height: 38px;
    border: 1px solid #b8c3b9;
    border-radius: 10px;
    background: #fffef7;
    color: #202722;
}
.fs-viz__toggle {
    grid-auto-flow: column;
    align-items: center;
    justify-content: start;
    white-space: nowrap;
}
.fs-viz__toggle input {
    accent-color: #1f7a64;
}
.fs-viz__button {
    padding: 0 14px;
    border: 1px solid #b8c3b9;
    border-radius: 10px;
}
.fs-viz__metrics {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 10px;
    padding: 16px 30px 10px;
    background: #f7f9f2;
}
.fs-viz__metric {
    min-height: 76px;
    padding: 14px;
    border: 1px solid #d9e0d8;
    border-radius: 12px;
    background: #fffef7;
}
.fs-viz__metric strong {
    display: block;
    margin-top: 8px;
    color: #202722;
    font: 700 18px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.fs-viz__grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
    padding: 0 30px 30px;
    background: #f7f9f2;
}
.fs-viz__panel {
    min-width: 0;
    padding: 14px;
    border: 1px solid #d9e0d8;
    border-radius: 12px;
    background: #fffef7;
}
.fs-viz__panel--wide {
    grid-column: 1 / -1;
}
.fs-viz__panel-head {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 10px;
}
.fs-viz__panel h2 {
    color: #202722;
    font-size: 17px;
    line-height: 1.2;
    letter-spacing: 0;
}
.fs-viz__panel p {
    max-width: 380px;
    color: #66716b;
    font-size: 13px;
    line-height: 1.35;
    text-align: right;
}
.fs-viz__canvas {
    display: block;
    width: 100%;
    min-height: 180px;
    border-radius: 8px;
}
.fs-viz__canvas--raster {
    height: 430px;
}
.fs-viz__canvas--medium {
    height: 260px;
}
.fs-viz__footer {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(260px, 1fr);
    gap: 20px;
    padding: 0 30px 28px;
    color: #66716b;
    font-size: 13px;
    line-height: 1.45;
    background: #f7f9f2;
}
.fs-viz__footer div {
    display: grid;
    gap: 4px;
    font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.fs-viz__footer span[data-level="error"] {
    color: #bb4b36;
}
.fs-viz__footer span[data-level="warn"] {
    color: #a46221;
}
.fs-viz__footer span[data-level="ok"] {
    color: #1f7a64;
}
@media (max-width: 980px) {
    .fs-viz__header,
    .fs-viz__toolbar,
    .fs-viz__metrics,
    .fs-viz__grid,
    .fs-viz__footer {
        grid-template-columns: 1fr;
    }
    .fs-viz__header,
    .fs-viz__toolbar,
    .fs-viz__metrics,
    .fs-viz__grid,
    .fs-viz__footer {
        padding-left: 18px;
        padding-right: 18px;
    }
    .fs-viz h1 {
        font-size: 42px;
        line-height: 1;
    }
    .fs-viz__panel-head {
        display: grid;
    }
    .fs-viz__panel p {
        text-align: left;
    }
    .fs-viz__header-aside {
        grid-template-columns: minmax(0, 1fr) 112px;
    }
}
@media (max-width: 520px) {
    .fs-viz__shell {
        border-radius: 16px;
    }
    .fs-viz h1 {
        font-size: 34px;
    }
    .fs-viz__subtitle {
        font-size: 14px;
    }
    .fs-viz__toolbar {
        gap: 10px;
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
    .fs-viz__header-aside {
        grid-template-columns: 1fr;
    }
    .fs-viz__media {
        display: none;
    }
    .fs-viz__canvas--raster {
        height: 360px;
    }
    .fs-viz__canvas--medium {
        height: 220px;
    }
}
`
