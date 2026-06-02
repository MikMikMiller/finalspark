export function createKernelMarkup({ stylesheetHref, height } = {}) {
  const heightStyle = height ? ` style="--kernel-height: ${escapeAttribute(formatCssLength(height))}"` : "";

  return `
    <link rel="stylesheet" href="${escapeAttribute(stylesheetHref)}">
    <div class="fs-kernel-root"${heightStyle}>
      <a class="skip-link" href="#fs-kernel-app">Skip to signals</a>
      <header class="topbar">
        <div class="brand-lockup">
          <div class="topbar-copy">
            <h1>Embeddable Time-Series Kernel</h1>
            <p class="lede">
              A zero-build read-only signal viewer with live, frozen, and demo source adapters.
            </p>
          </div>
        </div>
      </header>

      <main class="app-shell" id="fs-kernel-app">
        <section class="control-strip" aria-label="Controls">
          <div class="source-control">
            <span>Source</span>
            <div class="source-switch" aria-label="Data source">
              <button type="button" data-source="live" class="is-active" aria-pressed="true">Live</button>
              <button type="button" data-source="frozen" aria-pressed="false">Frozen</button>
              <button type="button" data-source="demo" aria-pressed="false">Demo</button>
            </div>
          </div>
          <div class="view-control">
            <span>View</span>
            <div class="source-switch view-switch" aria-label="View">
              <button type="button" data-view="overview" class="is-active" aria-pressed="true">Overview</button>
              <button type="button" data-view="mapping" aria-pressed="false">Mapping</button>
              <button type="button" data-view="explain" aria-pressed="false">Explain</button>
            </div>
          </div>
          <details class="control-drawer" open>
            <summary>
              <span>Controls</span>
              <small id="controlSummary">50 uV | +/-100 uV | 12s | Local labels</small>
            </summary>
            <div class="control-drawer-body">
              <label class="control-field control-field-threshold">
                Threshold
                <input id="threshold" name="thresholdUv" type="range" min="10" max="500" step="5" value="50" autocomplete="off">
                <span id="thresholdValue">50 uV</span>
              </label>
              <label class="control-field control-field-range">
                Trace range
                <select id="range" name="traceRangeUv" autocomplete="off"></select>
              </label>
              <label class="control-field control-field-window">
                Window
                <select id="window" name="windowSeconds" autocomplete="off"></select>
              </label>
              <label class="check-row control-field-labels">
                <input id="absoluteIndex" name="absoluteIndex" type="checkbox" autocomplete="off">
                Absolute index
              </label>
            </div>
          </details>
          <button type="button" id="pause" class="control-action">Pause</button>
          <button type="button" id="clear" class="control-action">Clear</button>
          <div class="status-box" data-level="info">
            <span>Source status</span>
            <strong id="statusHeadline" aria-live="polite">Starting</strong>
            <small id="freshnessMeta" class="freshness-meta">Waiting for frame</small>
            <details class="status-log">
              <summary>Log</summary>
              <pre id="sourceStatus">Starting</pre>
            </details>
          </div>
        </section>

        <section class="metric-row" aria-label="Live metrics">
          <div class="metric metric-sample">
            <span>Sample</span>
            <div class="sample-badges" id="sampleMeta">
              <span class="sample-badge">Waiting</span>
            </div>
          </div>
          <div class="metric"><span>Population rate</span><strong id="populationRate">0 Hz</strong></div>
          <div class="metric"><span>Active channels</span><strong id="activeChannels">0</strong></div>
          <div class="metric"><span>Crossings</span><strong id="totalCrossings">0</strong></div>
          <div class="metric"><span>Sample rate</span><strong id="sampleRate">3749.9 Hz</strong></div>
        </section>

        <section class="mea-stat-grid" id="meaStats" aria-label="MEA summary"></section>

        <section class="dashboard-grid">
          <article class="panel panel-wide" data-view-panel="overview">
            <div class="panel-header">
              <div>
                <h2>Activity Raster</h2>
                <p>Each tick is a client-side threshold crossing, not an assigned unit identity.</p>
              </div>
              <span class="panel-meta" id="rasterMeta">12 s window</span>
            </div>
            <canvas
              id="rasterCanvas"
              height="460"
              role="img"
              aria-label="Rolling raster plot of threshold crossings across channels."
              aria-describedby="rasterSummary"
            >Rolling raster plot of threshold crossings across channels.</canvas>
            <p id="rasterSummary" class="chart-summary">Waiting for threshold crossings.</p>
          </article>

          <article class="panel panel-wide" data-view-panel="mapping">
            <div class="panel-header">
              <div>
                <h2>Activity-Rate Heatmap</h2>
                <p>Logical electrode layout by index across four MEAs. No anatomical regions are inferred.</p>
              </div>
              <span class="panel-meta" id="heatmapMeta">Scale 0-20.0 Hz</span>
            </div>
            <canvas
              id="heatmapCanvas"
              height="320"
              role="img"
              aria-label="Activity-rate heatmap for four MEAs."
              aria-describedby="heatmapSummary"
            >Activity-rate heatmap for four MEAs.</canvas>
            <div class="heatmap-legend" aria-label="Heatmap color scale">
              <span>0 Hz</span>
              <span class="heatmap-ramp" aria-hidden="true"></span>
              <span id="heatmapLegendMax">20.0 Hz</span>
            </div>
            <p id="heatmapSummary" class="chart-summary">Waiting for activity-rate data.</p>
          </article>

          <article class="panel" data-view-panel="overview">
            <div class="panel-header">
              <div>
                <h2>Activity Timeline</h2>
                <p>Population crossings per second across currently available channels.</p>
              </div>
              <span class="panel-meta" id="timelineMeta">Waiting</span>
            </div>
            <canvas
              id="timelineCanvas"
              height="250"
              role="img"
              aria-label="Population activity timeline."
              aria-describedby="timelineSummary"
            >Population activity timeline.</canvas>
            <p id="timelineSummary" class="chart-summary">Waiting for timeline data.</p>
          </article>

          <article class="panel" data-view-panel="mapping">
            <div class="panel-header">
              <div>
                <h2>Center of Activity</h2>
                <p>A weighted average electrode position from crossing counts.</p>
              </div>
              <span class="panel-meta" id="centerMeta">0/4 active</span>
            </div>
            <canvas
              id="centerCanvas"
              height="250"
              role="img"
              aria-label="Weighted center of activity by MEA."
              aria-describedby="centerSummary"
            >Weighted center of activity by MEA.</canvas>
            <p id="centerSummary" class="chart-summary">Waiting for center-of-activity data.</p>
          </article>

          <article class="panel panel-wide" data-view-panel="overview explain">
            <div class="panel-header">
              <div>
                <h2>Signals vs Noise</h2>
                <p>The shaded band is the current threshold. Crossings outside it are counted.</p>
              </div>
              <span class="panel-meta" id="signalMeta">+/-50 uV</span>
            </div>
            <canvas
              id="signalCanvas"
              height="250"
              role="img"
              aria-label="Voltage trace for the most active electrode against the current threshold."
              aria-describedby="signalSummary noiseSummary"
            >Voltage trace for the most active electrode against the current threshold.</canvas>
            <p id="signalSummary" class="chart-summary">Waiting for probe-channel signal data.</p>
            <p id="noiseSummary" class="microcopy">Waiting for a probe channel.</p>
          </article>

          <details class="help-drawer" data-view-panel="explain" open>
            <summary>
              <span>Reading the stream</span>
              <small>MEA, biochip, threshold, and activity terms</small>
            </summary>
            <dl class="explain-list">
              <div>
                <dt>Source adapter</dt>
                <dd>Every source emits the same channel-major frame: time bounds, sample rate, units, and samples.</dd>
              </div>
              <div>
                <dt>MEA</dt>
                <dd>A multi-electrode array. The public live adapter exposes 4 MEAs, 32 electrodes each.</dd>
              </div>
              <div>
                <dt>Biochip</dt>
                <dd>Each MEA is grouped into four logical 8-electrode biochips.</dd>
              </div>
              <div>
                <dt>Window</dt>
                <dd>The current public live adapter receives 4096 samples per pushed frame, roughly 1092.3 ms of raw voltage.</dd>
              </div>
              <div>
                <dt>Threshold</dt>
                <dd>Crossings are simple voltage threshold events. No sorting or unit identity is inferred.</dd>
              </div>
              <div>
                <dt>Center of Activity</dt>
                <dd>A statistical average position weighted by crossing counts, not a biological region.</dd>
              </div>
            </dl>
            <p id="mappingProbe" class="mapping-probe"></p>
          </details>
        </section>
      </main>

      <footer class="footer">
        <p>
          Public-stream-only viewer. Live mode uses the public FinalSpark LiveMEA stream; frozen and demo modes keep the kernel inspectable from any static host.
        </p>
      </footer>
    </div>
  `;
}

function formatCssLength(value) {
  if (typeof value === "number") return `${Math.max(120, value)}px`;
  const text = String(value).trim();
  return text || "auto";
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}
