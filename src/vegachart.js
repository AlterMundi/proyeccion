import {A2uiLitElement} from '@a2ui/lit';
import {html} from 'lit';
import {parse, View} from 'vega';
import {compile} from 'vega-lite';
import {expressionInterpreter} from 'vega-interpreter';
import definition from './catalogs/vegachart.json' with {type: 'json'};
import {loadCatalog} from './catalog.js';

const defaultHeight = 290;
const defaultWidth = 360;

async function denyResource() {
  throw new Error('This chart accepts inline resources only');
}

function chartSpec(spec, height) {
  const schema = typeof spec.$schema === 'string' ? spec.$schema : '';
  const lite = /\/vega-lite\//.test(schema)
    || (!schema && ['mark', 'layer', 'facet', 'repeat', 'concat', 'hconcat', 'vconcat']
      .some(key => Object.hasOwn(spec, key)));
  const input = structuredClone(spec);
  const chart = lite ? compile(input).spec : input;
  return {...chart, width: chart.width ?? defaultWidth, height};
}

class VegaChartElement extends A2uiLitElement {
  #view;
  #spec;
  #height;

  connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }

  disconnectedCallback() {
    this.#view?.finalize();
    this.#view = undefined;
    this.#spec = undefined;
    super.disconnectedCallback();
  }

  render() {
    return html`<div data-vega-chart></div>`;
  }

  updated(changes) {
    super.updated(changes);
    const {spec, height = defaultHeight} = this.controller?.props ?? {};
    if (this.#spec === spec && this.#height === height) return;
    this.#spec = spec;
    this.#height = height;
    this.#view?.finalize();
    this.#view = undefined;
    const container = this.renderRoot.querySelector('[data-vega-chart]');
    container.replaceChildren();
    if (spec == null) return;
    if (typeof spec !== 'object' || Array.isArray(spec)) {
      container.textContent = 'Chart unavailable';
      return;
    }
    this.#mountChart(container, spec, height);
  }

  #mountChart(container, spec, height) {
    let view;
    let denied = false;
    const showFailure = () => {
      if (this.#view === view) container.textContent = 'Chart unavailable';
    };
    const deny = () => {
      denied = true;
      if (view) showFailure();
      return denyResource();
    };
    try {
      const runtime = parse(chartSpec(spec, height), undefined, {ast: true});
      // A chart can react to its own events and must leave host controls alone.
      runtime.bindings = [];
      runtime.eventConfig = {...runtime.eventConfig, window: false, selector: false, globalCursor: false};
      view = new View(runtime, {
        renderer: 'svg', expr: expressionInterpreter, loader: {load: deny, sanitize: deny},
      });
      this.#view = view;
      void view.initialize(container).runAsync().then(() => { if (denied) showFailure(); }, showFailure);
    } catch {
      view?.finalize();
      this.#view = undefined;
      container.textContent = 'Chart unavailable';
    }
  }
}

const catalog = loadCatalog(definition);
export const vegaChartCatalog = catalog.copyWith({components: [{
  ...catalog.components.get('VegaChart'), tagName: 'proyeccion-vega-chart', element: VegaChartElement,
}]});
