import { App } from "./src/app.js?v=20260602-nwb";
import { createKernelMarkup } from "./src/embed-template.js?v=20260602-nwb";

const mounted = new WeakMap();

export async function mount(target, options = {}) {
  const element = resolveTarget(target);
  const previous = mounted.get(element);
  previous?.stop();

  const shadow = element.shadowRoot ?? element.attachShadow({ mode: "open" });
  const stylesheetHref = options.stylesheetHref ?? new URL("./styles.css", import.meta.url).href;
  shadow.innerHTML = createKernelMarkup({
    stylesheetHref,
    height: options.height,
  });

  const app = new App(shadow, normalizeOptions(options));
  const controller = {
    element,
    root: shadow,
    app,
    stop() {
      app.stop();
      shadow.replaceChildren();
      mounted.delete(element);
    },
  };

  mounted.set(element, controller);
  await app.start();
  return controller;
}

class FsKernelElement extends HTMLElement {
  static observedAttributes = ["source", "src", "height", "view", "window", "mea-id"];

  connectedCallback() {
    this.restart();
  }

  disconnectedCallback() {
    mounted.get(this)?.stop();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.restart();
  }

  restart() {
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      mount(this, optionsFromElement(this)).catch((error) => {
        this.textContent = error.message;
      });
    }, 0);
  }
}

if (typeof customElements !== "undefined" && !customElements.get("fs-kernel")) {
  customElements.define("fs-kernel", FsKernelElement);
}

function resolveTarget(target) {
  if (typeof target === "string") {
    const element = document.querySelector(target);
    if (!element) throw new Error(`No mount target found for selector: ${target}`);
    return element;
  }
  if (target instanceof Element) return target;
  throw new TypeError("mount target must be a selector or Element");
}

function optionsFromElement(element) {
  return {
    source: element.getAttribute("source") ?? undefined,
    src: element.getAttribute("src") ?? undefined,
    height: element.getAttribute("height") ?? undefined,
    view: element.getAttribute("view") ?? undefined,
    window: element.getAttribute("window") ?? undefined,
    meaId: element.getAttribute("mea-id") ?? undefined,
  };
}

function normalizeOptions(options) {
  return {
    source: options.source,
    src: options.src,
    height: options.height,
    view: options.view,
    window: options.window,
    windowSeconds: options.windowSeconds,
    meaId: options.meaId,
    positionMs: options.positionMs,
    loop: options.loop,
    urlState: options.urlState,
  };
}
