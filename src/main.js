import { mount } from "../fs-kernel.mjs?v=20260601-perf";

const target = document.querySelector("[data-fs-kernel-mount]");
if (target) {
  mount(target, { ...target.dataset });
}
