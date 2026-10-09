// Derived from pinned lark-cli Sheets flag declarations.
import type { JsonObject } from "../../domain/models";
export const chartFlags: Record<string, Record<string, JsonObject>> = {
  "chart-create-basic": {
    "chart-type": {
      "type": "string",
      "enum": [
        "column",
        "bar",
        "line",
        "area",
        "pie",
        "scatter",
        "combo",
        "radar",
        "bubble",
        "waterfall",
        "pareto"
      ]
    },
    "data-range": {
      "type": "string"
    },
    "header-range": {
      "type": "string"
    },
    "data-direction": {
      "type": "string",
      "enum": [
        "column",
        "row"
      ]
    },
    "aggregate-categories": {
      "type": "boolean"
    },
    "x-axis-numbers-as": {
      "type": "string",
      "enum": [
        "text",
        "values"
      ]
    },
    "x-axis-min": {
      "type": "number"
    },
    "x-axis-max": {
      "type": "number"
    },
    "y-axis-min": {
      "type": "number"
    },
    "y-axis-max": {
      "type": "number"
    },
    "dim1-index": {
      "type": "integer"
    },
    "dim2-indexes": {
      "type": "string"
    },
    "series-types": {
      "type": "string"
    },
    "series-y-axes": {
      "type": "string"
    },
    "key-index": {
      "type": "integer"
    },
    "x-index": {
      "type": "integer"
    },
    "y-index": {
      "type": "integer"
    },
    "group-index": {
      "type": "integer"
    },
    "size-index": {
      "type": "integer"
    },
    "title": {
      "type": "string"
    },
    "subtitle": {
      "type": "string"
    },
    "legend-position": {
      "type": "string",
      "enum": [
        "top",
        "bottom",
        "left",
        "right",
        "hidden"
      ]
    },
    "x-axis-title": {
      "type": "string"
    },
    "y-axis-title": {
      "type": "string"
    },
    "secondary-y-axis-title": {
      "type": "string"
    },
    "x-axis-label-angle": {
      "type": "integer",
      "enum": [
        "-90",
        "-45",
        "0",
        "45",
        "90"
      ]
    },
    "y-axis-label-angle": {
      "type": "integer",
      "enum": [
        "-90",
        "-45",
        "0",
        "45",
        "90"
      ]
    },
    "data-labels": {
      "type": "string",
      "enum": [
        "none",
        "value",
        "category",
        "percentage",
        "value_category",
        "value_percentage",
        "category_percentage",
        "value_category_percentage",
        "series"
      ]
    },
    "data-label-position": {
      "type": "string",
      "enum": [
        "auto",
        "top",
        "bottom",
        "left",
        "right",
        "center",
        "inside",
        "outside"
      ]
    },
    "stack": {
      "type": "string",
      "enum": [
        "none",
        "normal",
        "percent"
      ]
    },
    "stacked": {
      "type": "boolean"
    },
    "smooth": {
      "type": "boolean"
    },
    "color-palette": {
      "type": "string",
      "enum": [
        "brandColorSeries@v2",
        "rainbowColorSeries@v2",
        "complementaryColorSeries@v2",
        "converseColorSeries@v2",
        "primaryColorSeries@v2",
        "singleColorSeries-B-@v2",
        "singleColorSeries-W-@v2",
        "singleColorSeries-G-@v2",
        "singleColorSeries-Y-@v2",
        "singleColorSeries-O-@v2",
        "singleColorSeries-R-@v2",
        "singleColorSeries-D-@v2"
      ]
    },
    "colors": {
      "type": "string"
    },
    "anchor-cell": {
      "type": "string"
    },
    "width": {
      "type": "integer"
    },
    "height": {
      "type": "integer"
    }
  },
  "chart-config-update": {
    "chart-id": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "subtitle": {
      "type": "string"
    },
    "legend-position": {
      "type": "string",
      "enum": [
        "top",
        "bottom",
        "left",
        "right",
        "hidden"
      ]
    },
    "x-axis-title": {
      "type": "string"
    },
    "y-axis-title": {
      "type": "string"
    },
    "secondary-y-axis-title": {
      "type": "string"
    },
    "x-axis-label-angle": {
      "type": "integer",
      "enum": [
        "-90",
        "-45",
        "0",
        "45",
        "90"
      ]
    },
    "y-axis-label-angle": {
      "type": "integer",
      "enum": [
        "-90",
        "-45",
        "0",
        "45",
        "90"
      ]
    },
    "x-axis-min": {
      "type": "number"
    },
    "x-axis-max": {
      "type": "number"
    },
    "y-axis-min": {
      "type": "number"
    },
    "y-axis-max": {
      "type": "number"
    },
    "data-labels": {
      "type": "string",
      "enum": [
        "none",
        "value",
        "category",
        "percentage",
        "value_category",
        "value_percentage",
        "category_percentage",
        "value_category_percentage",
        "series"
      ]
    },
    "data-label-position": {
      "type": "string",
      "enum": [
        "auto",
        "top",
        "bottom",
        "left",
        "right",
        "center",
        "inside",
        "outside"
      ]
    },
    "aggregate-categories": {
      "type": "boolean"
    },
    "stack": {
      "type": "string",
      "enum": [
        "none",
        "normal",
        "percent"
      ]
    },
    "stacked": {
      "type": "boolean"
    },
    "smooth": {
      "type": "boolean"
    },
    "color-palette": {
      "type": "string",
      "enum": [
        "brandColorSeries@v2",
        "rainbowColorSeries@v2",
        "complementaryColorSeries@v2",
        "converseColorSeries@v2",
        "primaryColorSeries@v2",
        "singleColorSeries-B-@v2",
        "singleColorSeries-W-@v2",
        "singleColorSeries-G-@v2",
        "singleColorSeries-Y-@v2",
        "singleColorSeries-O-@v2",
        "singleColorSeries-R-@v2",
        "singleColorSeries-D-@v2"
      ]
    },
    "colors": {
      "type": "string"
    }
  },
  "chart-data-update": {
    "chart-id": {
      "type": "string"
    },
    "data-range": {
      "type": "string"
    },
    "header-range": {
      "type": "string"
    },
    "data-direction": {
      "type": "string",
      "enum": [
        "column",
        "row"
      ]
    },
    "dim1-index": {
      "type": "integer"
    },
    "dim2-indexes": {
      "type": "string"
    },
    "key-index": {
      "type": "integer"
    },
    "x-index": {
      "type": "integer"
    },
    "y-index": {
      "type": "integer"
    },
    "group-index": {
      "type": "integer"
    },
    "size-index": {
      "type": "integer"
    }
  },
  "batch-chart-create": {
    "operations": {
      "anyOf": [
        {
          "type": "array"
        },
        {
          "type": "object"
        },
        {
          "type": "string"
        }
      ]
    },
    "continue-on-error": {
      "type": "boolean"
    }
  },
  "batch-chart-update": {
    "operations": {
      "anyOf": [
        {
          "type": "array"
        },
        {
          "type": "object"
        },
        {
          "type": "string"
        }
      ]
    },
    "continue-on-error": {
      "type": "boolean"
    }
  }
};
