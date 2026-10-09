// Generated from pinned MIT-licensed larksuite/cli flag vocabulary.
export const commandAliases: Record<string, Record<string, string>> = {
  "csv-put": {
    "file": "csv",
    "csv-file": "csv",
    "data": "csv",
    "content": "csv",
    "csv-data": "csv",
    "text": "csv"
  },
  "sheet-create": {
    "name": "title",
    "sheet-name": "title"
  },
  "sheet-rename": {
    "name": "title",
    "new-name": "title",
    "new-title": "title",
    "new-sheet-name": "title"
  },
  "dim-delete": {
    "position": "range"
  },
  "cols-resize": {
    "cols": "range",
    "size": "width"
  },
  "rows-resize": {
    "rows": "range",
    "size": "height"
  },
  "range-fill": {
    "source": "source-range",
    "target": "target-range"
  },
  "range-copy": {
    "source": "source-range",
    "target": "target-range"
  },
  "range-move": {
    "source": "source-range",
    "target": "target-range"
  },
  "chart-create-basic": {
    "type": "chart-type",
    "range": "data-range",
    "x-axis": "x-axis-title",
    "y-axis": "y-axis-title"
  },
  "chart-config-update": {
    "x-axis": "x-axis-title",
    "y-axis": "y-axis-title"
  },
  "chart-data-update": {
    "range": "data-range"
  },
  "cells-set": {
    "values": "cells",
    "value": "cells"
  },
  "cond-format-create": {
    "range": "ranges"
  },
  "cond-format-update": {
    "range": "ranges"
  },
  "cells-set-style": {
    "border-type": "border-styles",
    "border": "border-styles",
    "border-all": "border-styles",
    "border-style": "border-styles",
    "wrap-text": "word-wrap",
    "wrap-strategy": "word-wrap",
    "text-wrap": "word-wrap",
    "wrap": "word-wrap"
  },
  "cells-batch-set-style": {
    "border-type": "border-styles",
    "border": "border-styles",
    "border-all": "border-styles",
    "border-style": "border-styles",
    "wrap-text": "word-wrap",
    "wrap-strategy": "word-wrap",
    "text-wrap": "word-wrap",
    "wrap": "word-wrap"
  },
  "workbook-import": {
    "title": "name"
  },
  "workbook-export": {
    "file": "output-path",
    "outdir": "output-path",
    "output-dir": "output-path",
    "output": "output-path",
    "type": "file-extension"
  },
  "cells-replace": {
    "replace": "replacement"
  },
  "csv-get": {
    "output": "output-path"
  }
};
export const domainAliases: Record<string, string> = {
  "sheet": "sheet-name",
  "sheet_name": "sheet-name",
  "spreadsheet": "spreadsheet-token",
  "spreadsheet-id": "spreadsheet-token",
  "ranges": "range",
  "output": "output-path",
  "file-path": "output-path",
  "font-name": "font-family",
  "horizontal-align": "horizontal-alignment",
  "vertical-align": "vertical-alignment",
  "halign": "horizontal-alignment",
  "valign": "vertical-alignment",
  "conditional-format-id": "rule-id",
  "file-format": "file-extension",
  "file-type": "file-extension",
  "sort-conditions": "sort-keys",
  "sort-rules": "sort-keys",
  "sort-spec": "sort-keys",
  "back-color": "background-color",
  "bg-color": "background-color",
  "fill-color": "background-color",
  "text-color": "font-color",
  "query": "find",
  "search": "find",
  "items": "options"
};
export const flagTypes: Record<string, Record<string, string>> = {
  "formula-verify": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string_slice",
    "sheet-name": "string_slice",
    "range": "string_slice",
    "max-locations": "int",
    "exit-on-error": "bool",
    "ai-only": "bool"
  },
  "workbook-info": {
    "url": "string",
    "spreadsheet-token": "string"
  },
  "sheet-list": {
    "url": "string",
    "spreadsheet-token": "string"
  },
  "revision-get": {
    "url": "string",
    "spreadsheet-token": "string"
  },
  "sheet-create": {
    "url": "string",
    "spreadsheet-token": "string",
    "title": "string",
    "index": "int",
    "row-count": "int",
    "col-count": "int",
    "type": "string"
  },
  "sheet-delete": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string"
  },
  "sheet-rename": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "title": "string"
  },
  "sheet-move": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "index": "int",
    "source-index": "int"
  },
  "sheet-copy": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "title": "string",
    "index": "int"
  },
  "sheet-hide": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string"
  },
  "sheet-unhide": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string"
  },
  "sheet-set-tab-color": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "color": "string"
  },
  "sheet-hide-gridline": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string"
  },
  "sheet-show-gridline": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string"
  },
  "workbook-create": {
    "title": "string",
    "folder-token": "string",
    "values": "string",
    "sheets": "string",
    "styles": "string"
  },
  "workbook-export": {
    "url": "string",
    "spreadsheet-token": "string",
    "file-extension": "string",
    "sheet-id": "string",
    "output-path": "string"
  },
  "workbook-import": {
    "file": "string",
    "folder-token": "string",
    "name": "string"
  },
  "sheet-info": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "include": "string_slice",
    "range": "string"
  },
  "dim-insert": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "inherit-style": "string",
    "position": "string",
    "count": "int"
  },
  "dim-delete": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "range": "string",
    "ranges": "string"
  },
  "dim-hide": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "range": "string"
  },
  "dim-unhide": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "range": "string"
  },
  "dim-freeze": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "dimension": "string",
    "count": "int",
    "rows": "int",
    "cols": "int"
  },
  "dim-group": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "depth": "int",
    "group-state": "string",
    "range": "string"
  },
  "dim-ungroup": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "depth": "int",
    "range": "string"
  },
  "dim-move": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "source-range": "string",
    "target": "string"
  },
  "cells-get": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "range": "string",
    "include": "string_slice",
    "max-chars": "int",
    "output-path": "string",
    "skip-hidden": "bool"
  },
  "dropdown-get": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "range": "string"
  },
  "csv-get": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "range": "string",
    "max-chars": "int",
    "output-path": "string",
    "include-row-prefix": "bool",
    "skip-hidden": "bool"
  },
  "table-get": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "range": "string",
    "max-chars": "int",
    "output-path": "string",
    "no-header": "bool"
  },
  "cells-search": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "find": "string",
    "range": "string",
    "match-case": "bool",
    "match-entire-cell": "bool",
    "regex": "bool",
    "include-formulas": "bool",
    "max-matches": "int",
    "offset": "int"
  },
  "cells-replace": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "find": "string",
    "replacement": "string",
    "range": "string",
    "match-case": "bool",
    "match-entire-cell": "bool",
    "regex": "bool",
    "include-formulas": "bool"
  },
  "cells-set": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "range": "string",
    "start-cell": "string",
    "cells": "string",
    "writes": "string",
    "allow-overwrite": "bool",
    "max-cells": "int",
    "copy-to-range": "string"
  },
  "cells-set-style": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "range": "string",
    "background-color": "string",
    "font-color": "string",
    "font-family": "string",
    "font-size": "float64",
    "font-style": "string",
    "font-weight": "string",
    "font-line": "string",
    "horizontal-alignment": "string",
    "vertical-alignment": "string",
    "word-wrap": "string",
    "number-format": "string",
    "border-styles": "string"
  },
  "cells-set-image": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "range": "string",
    "image": "string",
    "name": "string"
  },
  "dropdown-set": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "range": "string",
    "options": "string",
    "colors": "string",
    "multiple": "bool",
    "highlight": "bool",
    "source-range": "string"
  },
  "csv-put": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "start-cell": "string",
    "csv": "string",
    "allow-overwrite": "bool",
    "range": "string"
  },
  "table-put": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheets": "string",
    "styles": "string"
  },
  "cells-clear": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "range": "string",
    "scope": "string"
  },
  "cells-merge": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "range": "string",
    "merge-type": "string"
  },
  "cells-unmerge": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "range": "string"
  },
  "rows-resize": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "height": "int",
    "heights": "string",
    "type": "string",
    "range": "string"
  },
  "cols-resize": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "width": "int",
    "widths": "string",
    "type": "string",
    "range": "string"
  },
  "range-move": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "source-range": "string",
    "target-sheet-id": "string",
    "target-range": "string"
  },
  "range-copy": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "source-range": "string",
    "target-sheet-id": "string",
    "target-range": "string",
    "paste-type": "string"
  },
  "range-fill": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "source-range": "string",
    "target-range": "string",
    "series-type": "string"
  },
  "range-sort": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "range": "string",
    "sort-keys": "string",
    "has-header": "bool"
  },
  "styles-put": {
    "url": "string",
    "spreadsheet-token": "string",
    "styles": "string"
  },
  "batch-update": {
    "url": "string",
    "spreadsheet-token": "string",
    "operations": "string",
    "continue-on-error": "bool"
  },
  "batch-chart-create": {
    "url": "string",
    "spreadsheet-token": "string",
    "operations": "string",
    "continue-on-error": "bool"
  },
  "batch-chart-update": {
    "url": "string",
    "spreadsheet-token": "string",
    "operations": "string",
    "continue-on-error": "bool"
  },
  "cells-batch-set-style": {
    "url": "string",
    "spreadsheet-token": "string",
    "ranges": "string",
    "background-color": "string",
    "font-color": "string",
    "font-family": "string",
    "font-size": "float64",
    "font-style": "string",
    "font-weight": "string",
    "font-line": "string",
    "horizontal-alignment": "string",
    "vertical-alignment": "string",
    "word-wrap": "string",
    "number-format": "string",
    "border-styles": "string"
  },
  "dropdown-update": {
    "url": "string",
    "spreadsheet-token": "string",
    "ranges": "string",
    "options": "string",
    "colors": "string",
    "multiple": "bool",
    "highlight": "bool",
    "source-range": "string"
  },
  "dropdown-delete": {
    "url": "string",
    "spreadsheet-token": "string",
    "ranges": "string"
  },
  "cells-batch-clear": {
    "url": "string",
    "spreadsheet-token": "string",
    "ranges": "string",
    "scope": "string"
  },
  "chart-list": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "chart-id": "string"
  },
  "chart-create-basic": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "chart-type": "string",
    "data-range": "string",
    "header-range": "string",
    "data-direction": "string",
    "aggregate-categories": "bool",
    "x-axis-numbers-as": "string",
    "x-axis-min": "float64",
    "x-axis-max": "float64",
    "y-axis-min": "float64",
    "y-axis-max": "float64",
    "dim1-index": "int",
    "dim2-indexes": "string",
    "series-types": "string",
    "series-y-axes": "string",
    "key-index": "int",
    "x-index": "int",
    "y-index": "int",
    "group-index": "int",
    "size-index": "int",
    "title": "string",
    "subtitle": "string",
    "legend-position": "string",
    "x-axis-title": "string",
    "y-axis-title": "string",
    "secondary-y-axis-title": "string",
    "x-axis-label-angle": "int",
    "y-axis-label-angle": "int",
    "data-labels": "string",
    "data-label-position": "string",
    "stack": "string",
    "stacked": "bool",
    "smooth": "bool",
    "color-palette": "string",
    "colors": "string_slice",
    "anchor-cell": "string",
    "width": "int",
    "height": "int"
  },
  "chart-config-update": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "chart-id": "string",
    "title": "string",
    "subtitle": "string",
    "legend-position": "string",
    "x-axis-title": "string",
    "y-axis-title": "string",
    "secondary-y-axis-title": "string",
    "x-axis-label-angle": "int",
    "y-axis-label-angle": "int",
    "x-axis-min": "float64",
    "x-axis-max": "float64",
    "y-axis-min": "float64",
    "y-axis-max": "float64",
    "data-labels": "string",
    "data-label-position": "string",
    "aggregate-categories": "bool",
    "stack": "string",
    "stacked": "bool",
    "smooth": "bool",
    "color-palette": "string",
    "colors": "string_slice"
  },
  "chart-data-update": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "chart-id": "string",
    "data-range": "string",
    "header-range": "string",
    "data-direction": "string",
    "dim1-index": "int",
    "dim2-indexes": "string",
    "key-index": "int",
    "x-index": "int",
    "y-index": "int",
    "group-index": "int",
    "size-index": "int"
  },
  "chart-create": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "properties": "string",
    "print-example": "string"
  },
  "chart-update": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "chart-id": "string",
    "properties": "string"
  },
  "chart-delete": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "chart-id": "string"
  },
  "pivot-list": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "pivot-table-id": "string"
  },
  "pivot-create": {
    "url": "string",
    "spreadsheet-token": "string",
    "properties": "string",
    "target-position": "string",
    "target-sheet-id": "string",
    "target-sheet-name": "string",
    "source": "string",
    "range": "string"
  },
  "pivot-update": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "pivot-table-id": "string",
    "properties": "string"
  },
  "pivot-delete": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "pivot-table-id": "string"
  },
  "cond-format-list": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "rule-id": "string"
  },
  "cond-format-result-get": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "range": "string",
    "max-chars": "int"
  },
  "cond-format-create": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "properties": "string",
    "rule-type": "string",
    "ranges": "string"
  },
  "cond-format-update": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "rule-id": "string",
    "properties": "string",
    "rule-type": "string",
    "ranges": "string"
  },
  "cond-format-delete": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "rule-id": "string"
  },
  "filter-list": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string"
  },
  "filter-create": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "range": "string",
    "properties": "string"
  },
  "filter-update": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "properties": "string",
    "range": "string"
  },
  "filter-delete": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string"
  },
  "filter-view-list": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "view-id": "string"
  },
  "filter-view-create": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "properties": "string",
    "range": "string",
    "view-name": "string"
  },
  "filter-view-update": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "view-id": "string",
    "properties": "string",
    "range": "string",
    "view-name": "string"
  },
  "filter-view-delete": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "view-id": "string"
  },
  "sparkline-list": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "group-id": "string"
  },
  "sparkline-create": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "properties": "string"
  },
  "sparkline-update": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "group-id": "string",
    "properties": "string"
  },
  "sparkline-delete": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "group-id": "string"
  },
  "float-image-list": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "float-image-id": "string"
  },
  "float-image-create": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "image-name": "string",
    "image-token": "string",
    "image-uri": "string",
    "position-row": "int",
    "position-col": "string",
    "size-width": "int",
    "size-height": "int",
    "offset-row": "int",
    "offset-col": "int",
    "z-index": "int",
    "image": "string"
  },
  "float-image-update": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "float-image-id": "string",
    "image-name": "string",
    "image-token": "string",
    "image-uri": "string",
    "position-row": "int",
    "position-col": "string",
    "size-width": "int",
    "size-height": "int",
    "offset-row": "int",
    "offset-col": "int",
    "z-index": "int"
  },
  "float-image-delete": {
    "url": "string",
    "spreadsheet-token": "string",
    "sheet-id": "string",
    "sheet-name": "string",
    "float-image-id": "string"
  },
  "history-list": {
    "url": "string",
    "spreadsheet-token": "string",
    "end-version": "int"
  },
  "history-revert": {
    "url": "string",
    "spreadsheet-token": "string",
    "history-version-id": "string"
  },
  "history-revert-status": {
    "url": "string",
    "spreadsheet-token": "string",
    "transaction-id": "string"
  },
  "changeset-get": {
    "url": "string",
    "spreadsheet-token": "string",
    "start-revision": "int",
    "end-revision": "int"
  }
};
