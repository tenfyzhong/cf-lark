// Generated from pinned lark-cli chart examples (MIT); placeholder titles translated to English.
export const chartExamples = {
  "bubble": {
    "position": {
      "row": 1,
      "col": "G"
    },
    "size": {
      "width": 640,
      "height": 400
    },
    "snapshot": {
      "title": {
        "text": "Bubble chart title"
      },
      "plotArea": {
        "plot": {
          "type": "bubble",
          "extra": {
            "bubble": {
              "aggregate": false,
              "showNegativeSize": false,
              "opacityGradientStyle": "linear",
              "idLabel": {
                "visible": true
              }
            }
          }
        }
      },
      "data": {
        "refs": [
          {
            "value": "'Sheet1'!A1:E20"
          }
        ],
        "dim1": {
          "serie": {
            "index": 1
          }
        },
        "dim2": {
          "series": [
            {
              "index": 2,
              "role": "x"
            },
            {
              "index": 3,
              "role": "y"
            },
            {
              "index": 4,
              "role": "group"
            },
            {
              "index": 5,
              "role": "size"
            }
          ]
        }
      }
    }
  },
  "waterfall": {
    "position": {
      "row": 1,
      "col": "F"
    },
    "size": {
      "width": 640,
      "height": 400
    },
    "snapshot": {
      "title": {
        "text": "Waterfall chart title"
      },
      "plotArea": {
        "plot": {
          "type": "waterfall",
          "extra": {
            "waterfall": {
              "firstValueAsTotal": true,
              "lastValueAsSubtotal": true,
              "connectorLine": {
                "style": "solid",
                "width": 1
              },
              "totalLabels": {
                "template": "{{value}}"
              }
            }
          }
        }
      },
      "data": {
        "refs": [
          {
            "value": "'Sheet1'!A1:B10"
          }
        ],
        "dim1": {
          "serie": {
            "index": 1
          }
        },
        "dim2": {
          "series": [
            {
              "index": 2
            }
          ]
        }
      }
    }
  },
  "pareto": {
    "position": {
      "row": 1,
      "col": "F"
    },
    "size": {
      "width": 640,
      "height": 400
    },
    "snapshot": {
      "title": {
        "text": "Pareto chart title"
      },
      "plotArea": {
        "plot": {
          "type": "pareto",
          "extra": {
            "pareto": {
              "aggregateType": "sum",
              "categoryNumber": 5
            }
          },
          "series": [
            {
              "index": 1,
              "bars": {
                "gap": 0.25
              },
              "labels": {
                "value": true
              }
            },
            {
              "index": 2,
              "line": {
                "width": 2
              },
              "points": {
                "shape": "circle",
                "size": 6
              },
              "labels": {
                "percentage": true,
                "format": "0%"
              }
            }
          ]
        }
      },
      "data": {
        "refs": [
          {
            "value": "'Sheet1'!A1:B20"
          }
        ],
        "dim1": {
          "serie": {
            "index": 1,
            "aggregate": true
          }
        },
        "dim2": {
          "series": [
            {
              "index": 2,
              "aggregateType": "sum"
            }
          ]
        }
      }
    }
  },
  "scatter": {
    "position": {
      "row": 1,
      "col": "F"
    },
    "size": {
      "width": 640,
      "height": 400
    },
    "snapshot": {
      "title": {
        "text": "Scatter chart title"
      },
      "plotArea": {
        "plot": {
          "type": "scatter"
        }
      },
      "data": {
        "refs": [
          {
            "value": "'Sheet1'!A1:B20"
          }
        ],
        "dim1": {
          "serie": {
            "index": 1
          }
        },
        "dim2": {
          "series": [
            {
              "index": 2
            }
          ]
        }
      }
    }
  },
  "pie": {
    "position": {
      "row": 1,
      "col": "F"
    },
    "size": {
      "width": 720,
      "height": 440
    },
    "snapshot": {
      "title": {
        "text": "Pie chart title"
      },
      "plotArea": {
        "plot": {
          "type": "pie",
          "series": [
            {
              "index": 1,
              "sectors": {
                "sector": [
                  {
                    "index": 1,
                    "offsetRadius": 0.05
                  }
                ]
              }
            }
          ]
        }
      },
      "data": {
        "refs": [
          {
            "value": "'Sheet1'!A1:B11"
          }
        ],
        "dim1": {
          "serie": {
            "index": 1,
            "aggregate": true
          }
        },
        "dim2": {
          "series": [
            {
              "index": 2,
              "aggregateType": "sum"
            }
          ]
        }
      }
    }
  },
  "combo": {
    "position": {
      "row": 1,
      "col": "F"
    },
    "size": {
      "width": 720,
      "height": 420
    },
    "snapshot": {
      "title": {
        "text": "Combo chart title"
      },
      "plotArea": {
        "plot": {
          "type": "combo",
          "series": [
            {
              "index": 2,
              "comboType": "column"
            },
            {
              "index": 3,
              "comboType": "line"
            }
          ]
        }
      },
      "data": {
        "refs": [
          {
            "value": "'Sheet1'!A1:C13"
          }
        ],
        "dim1": {
          "serie": {
            "index": 1
          }
        },
        "dim2": {
          "series": [
            {
              "index": 2
            },
            {
              "index": 3
            }
          ]
        }
      }
    }
  },
  "column": {
    "position": {
      "row": 1,
      "col": "F"
    },
    "size": {
      "width": 640,
      "height": 400
    },
    "snapshot": {
      "title": {
        "text": "Chart title"
      },
      "plotArea": {
        "plot": {
          "type": "column"
        }
      },
      "data": {
        "refs": [
          {
            "value": "'Sheet1'!A1:C10"
          }
        ],
        "dim1": {
          "serie": {
            "index": 1
          }
        },
        "dim2": {
          "series": [
            {
              "index": 2
            },
            {
              "index": 3
            }
          ]
        }
      }
    }
  },
  "bar": {
    "position": {
      "row": 1,
      "col": "F"
    },
    "size": {
      "width": 720,
      "height": 420
    },
    "snapshot": {
      "title": {
        "text": "Chart title"
      },
      "plotArea": {
        "plot": {
          "type": "bar"
        }
      },
      "data": {
        "refs": [
          {
            "value": "'Sheet1'!A1:C10"
          }
        ],
        "dim1": {
          "serie": {
            "index": 1
          }
        },
        "dim2": {
          "series": [
            {
              "index": 2
            },
            {
              "index": 3
            }
          ]
        }
      }
    }
  },
  "line": {
    "position": {
      "row": 1,
      "col": "F"
    },
    "size": {
      "width": 640,
      "height": 400
    },
    "snapshot": {
      "title": {
        "text": "Chart title"
      },
      "plotArea": {
        "plot": {
          "type": "line"
        }
      },
      "data": {
        "refs": [
          {
            "value": "'Sheet1'!A1:C10"
          }
        ],
        "dim1": {
          "serie": {
            "index": 1
          }
        },
        "dim2": {
          "series": [
            {
              "index": 2
            },
            {
              "index": 3
            }
          ]
        }
      }
    }
  },
  "area": {
    "position": {
      "row": 1,
      "col": "F"
    },
    "size": {
      "width": 640,
      "height": 400
    },
    "snapshot": {
      "title": {
        "text": "Chart title"
      },
      "plotArea": {
        "plot": {
          "type": "area"
        }
      },
      "data": {
        "refs": [
          {
            "value": "'Sheet1'!A1:C10"
          }
        ],
        "dim1": {
          "serie": {
            "index": 1
          }
        },
        "dim2": {
          "series": [
            {
              "index": 2
            },
            {
              "index": 3
            }
          ]
        }
      }
    }
  },
  "radar": {
    "position": {
      "row": 1,
      "col": "F"
    },
    "size": {
      "width": 640,
      "height": 400
    },
    "snapshot": {
      "title": {
        "text": "Chart title"
      },
      "plotArea": {
        "plot": {
          "type": "radar"
        }
      },
      "data": {
        "refs": [
          {
            "value": "'Sheet1'!A1:C10"
          }
        ],
        "dim1": {
          "serie": {
            "index": 1
          }
        },
        "dim2": {
          "series": [
            {
              "index": 2
            },
            {
              "index": 3
            }
          ]
        }
      }
    }
  }
};
