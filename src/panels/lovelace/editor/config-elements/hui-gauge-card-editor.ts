import type { CSSResultGroup } from "lit";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators";
import { repeat } from "lit/directives/repeat";
import memoizeOne from "memoize-one";
import {
  array,
  assert,
  assign,
  boolean,
  number,
  object,
  optional,
  string,
} from "superstruct";
import {
  mdiDelete,
  mdiDragHorizontalVariant,
  mdiGestureTap,
  mdiPalette,
  mdiPlus,
} from "@mdi/js";
import { fireEvent } from "../../../../common/dom/fire_event";
import "../../../../components/ha-button";
import "../../../../components/ha-color-picker";
import "../../../../components/ha-expansion-panel";
import "../../../../components/ha-form/ha-form";
import type { SchemaUnion } from "../../../../components/ha-form/types";
import "../../../../components/ha-icon-button";
import "../../../../components/ha-sortable";
import "../../../../components/ha-svg-icon";
import "../../../../components/input/ha-input";
import type { HaInput } from "../../../../components/input/ha-input";
import { NON_NUMERIC_ATTRIBUTES } from "../../../../data/entity/entity_attributes";
import type { HomeAssistant } from "../../../../types";
import { DEFAULT_MAX, DEFAULT_MIN } from "../../cards/hui-gauge-card";
import type { GaugeCardConfig, GaugeSegment } from "../../cards/types";
import {
  ACTION_RELATED_CONTEXT,
  type UiAction,
  supportedActions,
} from "../../components/hui-action-editor";
import type { LovelaceCardEditor } from "../../types";
import { actionConfigStruct } from "../structs/action-struct";
import { baseLovelaceCardConfig } from "../structs/base-card-struct";
import { entityNameStruct } from "../structs/entity-name-struct";
import { configElementStyle } from "./config-elements-style";

const TAP_ACTIONS: UiAction[] = [
  "more-info",
  "navigate",
  "url",
  "perform-action",
  "assist",
  "none",
];

const gaugeSegmentStruct = object({
  from: number(),
  color: string(),
  label: optional(string()),
});

const cardConfigStruct = assign(
  baseLovelaceCardConfig,
  object({
    name: optional(entityNameStruct),
    entity: optional(string()),
    attribute: optional(string()),
    unit: optional(string()),
    min: optional(number()),
    max: optional(number()),
    severity: optional(object()),
    theme: optional(string()),
    needle: optional(boolean()),
    segments: optional(array(gaugeSegmentStruct)),
    tap_action: optional(supportedActions(actionConfigStruct, TAP_ACTIONS)),
    hold_action: optional(supportedActions(actionConfigStruct, TAP_ACTIONS)),
    double_tap_action: optional(
      supportedActions(actionConfigStruct, TAP_ACTIONS)
    ),
  })
);

@customElement("hui-gauge-card-editor")
export class HuiGaugeCardEditor
  extends LitElement
  implements LovelaceCardEditor
{
  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: GaugeCardConfig;

  private _segmentsKeys = new WeakMap<GaugeSegment, string>();

  public setConfig(config: GaugeCardConfig): void {
    assert(config, cardConfigStruct);
    this._config = config;
  }

  private _schema = memoizeOne(
    (entityId?: string) =>
      [
        {
          name: "entity",
          selector: {
            entity: {
              domain: ["counter", "input_number", "number", "sensor"],
            },
          },
        },
        {
          name: "attribute",
          selector: {
            attribute: {
              entity_id: entityId,
              hide_attributes: NON_NUMERIC_ATTRIBUTES,
            },
          },
        },
        {
          name: "name",
          selector: {
            entity_name: {},
          },
          context: { entity: "entity" },
        },
        { name: "unit", selector: { text: {} } },
        { name: "theme", selector: { theme: {} } },
        {
          name: "",
          type: "grid",
          schema: [
            {
              name: "min",
              default: DEFAULT_MIN,
              selector: { number: { mode: "box", step: "any" } },
            },
            {
              name: "max",
              default: DEFAULT_MAX,
              selector: { number: { mode: "box", step: "any" } },
            },
          ],
        },
        { name: "needle", selector: { boolean: {} } },
        {
          name: "interactions",
          type: "expandable",
          flatten: true,
          iconPath: mdiGestureTap,
          schema: [
            {
              name: "tap_action",
              selector: {
                ui_action: {
                  actions: TAP_ACTIONS,
                  default_action: "more-info",
                },
              },
              context: ACTION_RELATED_CONTEXT,
            },
            {
              name: "",
              type: "optional_actions",
              flatten: true,
              schema: (["hold_action", "double_tap_action"] as const).map(
                (action) => ({
                  name: action,
                  selector: {
                    ui_action: {
                      actions: TAP_ACTIONS,
                      default_action: "none" as const,
                    },
                  },
                  context: ACTION_RELATED_CONTEXT,
                })
              ),
            },
          ],
        },
      ] as const
  );

  private get _segments(): GaugeSegment[] {
    if (this._config?.segments) {
      return this._config.segments;
    }
    if (this._config?.severity) {
      const severity = this._config.severity;
      const segments: GaugeSegment[] = [];
      if (severity.green !== undefined) {
        segments.push({ from: severity.green, color: "green" });
      }
      if (severity.yellow !== undefined) {
        segments.push({ from: severity.yellow, color: "yellow" });
      }
      if (severity.red !== undefined) {
        segments.push({ from: severity.red, color: "red" });
      }
      return segments.sort((a, b) => a.from - b.from);
    }
    return [];
  }

  private _getKey(segment: GaugeSegment) {
    if (!this._segmentsKeys.has(segment)) {
      this._segmentsKeys.set(segment, Math.random().toString());
    }
    return this._segmentsKeys.get(segment)!;
  }

  protected render() {
    if (!this.hass || !this._config) {
      return nothing;
    }

    const schema = this._schema(this._config.entity);

    return html`
      <ha-form
        .hass=${this.hass}
        .data=${this._config}
        .schema=${schema}
        .computeLabel=${this._computeLabelCallback}
        @value-changed=${this._valueChanged}
      ></ha-form>
      <ha-expansion-panel outlined>
        <ha-svg-icon slot="leading-icon" .path=${mdiPalette}></ha-svg-icon>
        <h3 slot="header">
          ${this.hass.localize("ui.panel.lovelace.editor.card.gauge.segments")}
        </h3>
        <div class="content">${this._renderSegments()}</div>
      </ha-expansion-panel>
    `;
  }

  private _renderSegments() {
    const segments = this._segments;

    if (segments.length === 0) {
      return html`
        <div class="empty-state">
          <p>
            ${this.hass!.localize(
              "ui.panel.lovelace.editor.card.gauge.no_segments"
            )}
          </p>
          <div class="actions">
            <ha-button
              appearance="filled"
              size="s"
              @click=${this._addDefaultSegments}
            >
              <ha-svg-icon slot="start" .path=${mdiPlus}></ha-svg-icon>
              ${this.hass!.localize(
                "ui.panel.lovelace.editor.card.gauge.add_default_segments"
              )}
            </ha-button>
            <ha-button
              appearance="outlined"
              size="s"
              @click=${this._addSegment}
            >
              <ha-svg-icon slot="start" .path=${mdiPlus}></ha-svg-icon>
              ${this.hass!.localize(
                "ui.panel.lovelace.editor.card.gauge.add_segment"
              )}
            </ha-button>
          </div>
        </div>
      `;
    }

    return html`
      <ha-sortable handle-selector=".handle" @item-moved=${this._segmentMoved}>
        <div class="segments">
          ${repeat(
            segments,
            (segment) => this._getKey(segment),
            (segment, index) => html`
              <div class="segment">
                <div
                  class="handle"
                  role="button"
                  tabindex="0"
                  aria-label=${this.hass!.localize("ui.common.move")}
                >
                  <ha-svg-icon .path=${mdiDragHorizontalVariant}></ha-svg-icon>
                </div>
                <ha-input
                  class="from-field"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  data-index=${index}
                  .label=${this.hass!.localize(
                    "ui.panel.lovelace.editor.card.gauge.from"
                  )}
                  .value=${segment.from.toString()}
                  @change=${this._segmentFromChanged}
                ></ha-input>
                <ha-color-picker
                  class="color-field"
                  data-index=${index}
                  .label=${this.hass!.localize(
                    "ui.panel.lovelace.editor.card.generic.color"
                  )}
                  .value=${segment.color}
                  @value-changed=${this._segmentColorChanged}
                ></ha-color-picker>
                <ha-input
                  class="label-field"
                  type="text"
                  data-index=${index}
                  .label=${this.hass!.localize(
                    "ui.panel.lovelace.editor.card.gauge.segment_label"
                  )}
                  .value=${segment.label ?? ""}
                  @change=${this._segmentLabelChanged}
                ></ha-input>
                <ha-icon-button
                  class="remove-icon"
                  data-index=${index}
                  .label=${this.hass!.localize("ui.common.delete")}
                  .path=${mdiDelete}
                  @click=${this._removeSegment}
                ></ha-icon-button>
              </div>
            `
          )}
        </div>
      </ha-sortable>
      <ha-button appearance="filled" size="s" @click=${this._addSegment}>
        <ha-svg-icon slot="start" .path=${mdiPlus}></ha-svg-icon>
        ${this.hass!.localize("ui.panel.lovelace.editor.card.gauge.add_segment")}
      </ha-button>
    `;
  }

  private _segmentFromChanged(ev: Event): void {
    ev.stopPropagation();
    const target = ev.target as HaInput;
    const index = Number(target.dataset.index);
    const raw = target.value ?? "";
    const parsed = parseFloat(raw);
    const value = isNaN(parsed) ? 0 : parsed;
    const segments = this._segments.map((s, i) => {
      if (i !== index) {
        return s;
      }
      const newSegment = { ...s, from: value };
      const key = this._segmentsKeys.get(s);
      if (key) {
        this._segmentsKeys.set(newSegment, key);
      }
      return newSegment;
    });
    this._updateSegments(segments);
  }

  private _segmentColorChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const target = ev.currentTarget as HTMLElement;
    const index = Number(target.dataset.index);
    const color = ev.detail.value;
    if (!color) {
      return;
    }
    const segments = this._segments.map((s, i) => {
      if (i !== index) {
        return s;
      }
      const newSegment = { ...s, color };
      const key = this._segmentsKeys.get(s);
      if (key) {
        this._segmentsKeys.set(newSegment, key);
      }
      return newSegment;
    });
    this._updateSegments(segments);
  }

  private _segmentLabelChanged(ev: Event): void {
    ev.stopPropagation();
    const target = ev.target as HaInput;
    const index = Number(target.dataset.index);
    const label = target.value ? target.value.trim() : undefined;
    const segments = this._segments.map((s, i) => {
      if (i !== index) {
        return s;
      }
      const newSegment = { ...s };
      if (label) {
        newSegment.label = label;
      } else {
        delete newSegment.label;
      }
      const key = this._segmentsKeys.get(s);
      if (key) {
        this._segmentsKeys.set(newSegment, key);
      }
      return newSegment;
    });
    this._updateSegments(segments);
  }

  private _removeSegment(ev: Event): void {
    ev.stopPropagation();
    const target = ev.currentTarget as HTMLElement;
    const index = Number(target.dataset.index);
    const segments = this._segments.filter((_, i) => i !== index);
    this._updateSegments(segments);
  }

  private _addSegment(): void {
    const segments = [...this._segments];
    let nextFrom = this._config?.min ?? DEFAULT_MIN;
    if (segments.length > 0) {
      const maxFrom = Math.max(...segments.map((s) => s.from));
      nextFrom = maxFrom + 10;
    }
    const defaultColors = [
      "green",
      "yellow",
      "red",
      "blue",
      "purple",
      "orange",
    ];
    const color = defaultColors[segments.length] || "blue";
    segments.push({
      from: nextFrom,
      color,
    });
    this._updateSegments(segments);
  }

  private _addDefaultSegments(): void {
    const min = this._config?.min ?? DEFAULT_MIN;
    const max = this._config?.max ?? DEFAULT_MAX;
    const range = max - min;
    const segments: GaugeSegment[] = [
      { from: min, color: "green" },
      { from: Math.round(min + range * 0.4), color: "yellow" },
      { from: Math.round(min + range * 0.7), color: "red" },
    ];
    this._updateSegments(segments);
  }

  private _segmentMoved(ev: CustomEvent): void {
    ev.stopPropagation();
    const { oldIndex, newIndex } = ev.detail;
    const segments = [...this._segments];
    const item = segments.splice(oldIndex, 1)[0];
    segments.splice(newIndex, 0, item);
    this._updateSegments(segments);
  }

  private _updateSegments(segments: GaugeSegment[]): void {
    const config: GaugeCardConfig = { ...this._config! };
    if (segments.length > 0) {
      config.segments = segments;
    } else {
      delete config.segments;
    }
    delete config.severity;
    delete (config as any).show_severity;
    delete (config as any).green;
    delete (config as any).yellow;
    delete (config as any).red;

    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private _valueChanged(ev: CustomEvent): void {
    const config: GaugeCardConfig = { ...ev.detail.value };

    if (this._segments.length > 0) {
      config.segments = this._segments;
    }
    delete config.severity;
    delete (config as any).show_severity;
    delete (config as any).green;
    delete (config as any).yellow;
    delete (config as any).red;

    this._config = config;
    fireEvent(this, "config-changed", { config });
  }

  private _computeLabelCallback = (
    schema: SchemaUnion<ReturnType<typeof this._schema>>
  ) => {
    switch (schema.name) {
      case "name":
        return this.hass!.localize(
          "ui.panel.lovelace.editor.card.generic.name"
        );
      case "entity":
        return `${this.hass!.localize(
          "ui.panel.lovelace.editor.card.generic.entity"
        )} (${this.hass!.localize(
          "ui.panel.lovelace.editor.card.config.required"
        )})`;
      case "max":
        return this.hass!.localize(
          "ui.panel.lovelace.editor.card.generic.maximum"
        );
      case "min":
        return this.hass!.localize(
          "ui.panel.lovelace.editor.card.generic.minimum"
        );
      case "needle":
        return this.hass!.localize(
          "ui.panel.lovelace.editor.card.gauge.needle_gauge"
        );
      case "theme":
        return `${this.hass!.localize(
          "ui.panel.lovelace.editor.card.generic.theme"
        )} (${this.hass!.localize(
          "ui.panel.lovelace.editor.card.config.optional"
        )})`;
      case "unit":
        return this.hass!.localize(
          "ui.panel.lovelace.editor.card.generic.unit"
        );
      case "interactions":
        return this.hass!.localize(
          "ui.panel.lovelace.editor.card.generic.interactions"
        );
      case "tap_action":
      case "hold_action":
      case "double_tap_action":
        return `${this.hass!.localize(
          `ui.panel.lovelace.editor.card.generic.${schema.name}`
        )} (${this.hass!.localize(
          "ui.panel.lovelace.editor.card.config.optional"
        )})`;
      case "attribute":
        return this.hass!.localize(
          "ui.panel.lovelace.editor.card.generic.attribute"
        );
      default:
        return "";
    }
  };

  static get styles(): CSSResultGroup {
    return [
      configElementStyle,
      css`
        ha-expansion-panel {
          margin-top: var(--ha-space-4, 16px);
        }
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--ha-space-3, 12px);
          padding: var(--ha-space-3, 12px) 0;
          text-align: center;
          color: var(--secondary-text-color);
        }
        .empty-state p {
          margin: 0;
        }
        .empty-state .actions {
          display: flex;
          gap: var(--ha-space-2, 8px);
          flex-wrap: wrap;
          justify-content: center;
        }
        .segments {
          display: flex;
          flex-direction: column;
          gap: var(--ha-space-2, 8px);
          margin-bottom: var(--ha-space-3, 12px);
        }
        .segment {
          display: flex;
          align-items: center;
          gap: var(--ha-space-2, 8px);
        }
        .handle {
          cursor: move;
          cursor: grab;
          color: var(--secondary-text-color);
          display: flex;
          align-items: center;
          padding: var(--ha-space-1, 4px);
        }
        .handle > * {
          pointer-events: none;
        }
        .from-field {
          flex: 1;
          min-width: 80px;
        }
        .color-field {
          flex: 1;
          min-width: 120px;
        }
        .label-field {
          flex: 1;
          min-width: 100px;
        }
        .remove-icon {
          color: var(--secondary-text-color);
          --ha-icon-button-size: var(--ha-space-9, 36px);
          flex: none;
        }
        @media (max-width: 450px) {
          .segment {
            flex-wrap: wrap;
          }
          .from-field,
          .color-field,
          .label-field {
            flex: 1 1 40%;
          }
        }
      `,
    ];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hui-gauge-card-editor": HuiGaugeCardEditor;
  }
}
