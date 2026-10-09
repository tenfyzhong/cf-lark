import type { CommandDefinition } from '../../domain/models';
export const okrDefinitions: CommandDefinition[] = [
    {
        "id": "okr.+comment-create",
        "domain": "okr",
        "source": "shortcut",
        "risk": "write",
        "identities": [
            "user"
        ],
        "scopes": [
            "okr:okr.comment.writeonly"
        ],
        "description": "OKR comment-create. Inline JSON replaces local files and stdin.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "target-id": {
                    "type": "string"
                },
                "target-type": {
                    "type": "string"
                },
                "content": {
                    "anyOf": [
                        {
                            "type": "string"
                        },
                        {
                            "type": "object"
                        }
                    ]
                },
                "selected-text": {
                    "type": "string"
                },
                "select-all": {
                    "type": "boolean"
                },
                "ref-comment-id": {
                    "type": "string"
                },
                "user-id-type": {
                    "type": "string"
                },
                "style": {
                    "type": "string"
                }
            },
            "additionalProperties": false
        }
    },
    {
        "id": "okr.+comment-delete",
        "domain": "okr",
        "source": "shortcut",
        "risk": "write",
        "identities": [
            "user"
        ],
        "scopes": [
            "okr:okr.comment.delete"
        ],
        "description": "OKR comment-delete. Inline JSON replaces local files and stdin.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "comment-id": {
                    "type": "string"
                }
            },
            "additionalProperties": false
        }
    },
    {
        "id": "okr.+comment-get",
        "domain": "okr",
        "source": "shortcut",
        "risk": "read",
        "identities": [
            "user",
            "bot"
        ],
        "scopes": [
            "okr:okr.comment.readonly"
        ],
        "description": "OKR comment-get. Inline JSON replaces local files and stdin.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "comment-id": {
                    "type": "string"
                },
                "user-id-type": {
                    "type": "string"
                },
                "style": {
                    "type": "string"
                }
            },
            "additionalProperties": false
        }
    },
    {
        "id": "okr.+comment-list",
        "domain": "okr",
        "source": "shortcut",
        "risk": "read",
        "identities": [
            "user",
            "bot"
        ],
        "scopes": [
            "okr:okr.comment.readonly"
        ],
        "description": "OKR comment-list. Inline JSON replaces local files and stdin.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "target-id": {
                    "type": "string"
                },
                "target-type": {
                    "type": "string"
                },
                "page-size": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100
                },
                "page-token": {
                    "type": "string"
                },
                "user-id-type": {
                    "type": "string"
                },
                "style": {
                    "type": "string"
                }
            },
            "additionalProperties": false
        }
    },
    {
        "id": "okr.+comment-patch",
        "domain": "okr",
        "source": "shortcut",
        "risk": "write",
        "identities": [
            "user"
        ],
        "scopes": [
            "okr:okr.comment.writeonly"
        ],
        "description": "OKR comment-patch. Inline JSON replaces local files and stdin.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "comment-id": {
                    "type": "string"
                },
                "content": {
                    "anyOf": [
                        {
                            "type": "string"
                        },
                        {
                            "type": "object"
                        }
                    ]
                },
                "user-id-type": {
                    "type": "string"
                },
                "style": {
                    "type": "string"
                }
            },
            "additionalProperties": false
        }
    },
    {
        "id": "okr.+comment-reopen",
        "domain": "okr",
        "source": "shortcut",
        "risk": "write",
        "identities": [
            "user"
        ],
        "scopes": [
            "okr:okr.comment.writeonly"
        ],
        "description": "OKR comment-reopen. Inline JSON replaces local files and stdin.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "comment-id": {
                    "type": "string"
                },
                "user-id-type": {
                    "type": "string"
                },
                "style": {
                    "type": "string"
                }
            },
            "additionalProperties": false
        }
    },
    {
        "id": "okr.+comment-solve",
        "domain": "okr",
        "source": "shortcut",
        "risk": "write",
        "identities": [
            "user"
        ],
        "scopes": [
            "okr:okr.comment.writeonly"
        ],
        "description": "OKR comment-solve. Inline JSON replaces local files and stdin.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "comment-id": {
                    "type": "string"
                },
                "user-id-type": {
                    "type": "string"
                },
                "style": {
                    "type": "string"
                }
            },
            "additionalProperties": false
        }
    },
    {
        "id": "okr.+create",
        "domain": "okr",
        "source": "shortcut",
        "risk": "write",
        "identities": [
            "user",
            "bot"
        ],
        "scopes": [
            "okr:okr.content:writeonly"
        ],
        "description": "OKR create. Inline JSON replaces local files and stdin.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "level": {
                    "type": "string"
                },
                "cycle-id": {
                    "type": "string"
                },
                "objective-id": {
                    "type": "string"
                },
                "style": {
                    "type": "string"
                },
                "content": {
                    "anyOf": [
                        {
                            "type": "string"
                        },
                        {
                            "type": "object"
                        }
                    ]
                },
                "notes": {
                    "anyOf": [
                        {
                            "type": "string"
                        },
                        {
                            "type": "object"
                        }
                    ]
                },
                "category-id": {
                    "type": "string"
                },
                "user-id-type": {
                    "type": "string"
                }
            },
            "additionalProperties": false
        }
    },
    {
        "id": "okr.+cycle-list",
        "domain": "okr",
        "source": "shortcut",
        "risk": "read",
        "identities": [
            "user",
            "bot"
        ],
        "scopes": [
            "okr:okr.period:readonly"
        ],
        "description": "OKR cycle-list. Inline JSON replaces local files and stdin.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "user-id": {
                    "type": "string"
                },
                "user-id-type": {
                    "type": "string"
                },
                "time-range": {
                    "type": "string"
                },
                "page-size": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100
                },
                "page-token": {
                    "type": "string"
                }
            },
            "additionalProperties": false
        }
    },
    {
        "id": "okr.+patch",
        "domain": "okr",
        "source": "shortcut",
        "risk": "write",
        "identities": [
            "user",
            "bot"
        ],
        "scopes": [
            "okr:okr.content:writeonly"
        ],
        "description": "OKR patch. Inline JSON replaces local files and stdin.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "level": {
                    "type": "string"
                },
                "target-id": {
                    "type": "string"
                },
                "style": {
                    "type": "string"
                },
                "content": {
                    "anyOf": [
                        {
                            "type": "string"
                        },
                        {
                            "type": "object"
                        }
                    ]
                },
                "notes": {
                    "anyOf": [
                        {
                            "type": "string"
                        },
                        {
                            "type": "object"
                        }
                    ]
                },
                "score": {
                    "type": "string"
                },
                "deadline": {
                    "type": "string"
                },
                "user-id-type": {
                    "type": "string"
                }
            },
            "additionalProperties": false
        }
    },
    {
        "id": "okr.+progress-create",
        "domain": "okr",
        "source": "shortcut",
        "risk": "write",
        "identities": [
            "user",
            "bot"
        ],
        "scopes": [
            "okr:okr.progress:writeonly"
        ],
        "description": "OKR progress-create. Inline JSON replaces local files and stdin.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "content": {
                    "anyOf": [
                        {
                            "type": "string"
                        },
                        {
                            "type": "object"
                        }
                    ]
                },
                "target-id": {
                    "type": "string"
                },
                "target-type": {
                    "type": "string"
                },
                "progress-percent": {
                    "type": "string"
                },
                "progress-status": {
                    "type": "string"
                },
                "source-title": {
                    "type": "string"
                },
                "source-url": {
                    "type": "string"
                },
                "user-id-type": {
                    "type": "string"
                },
                "style": {
                    "type": "string"
                }
            },
            "additionalProperties": false
        }
    },
    {
        "id": "okr.+progress-delete",
        "domain": "okr",
        "source": "shortcut",
        "risk": "write",
        "identities": [
            "user",
            "bot"
        ],
        "scopes": [
            "okr:okr.progress:delete"
        ],
        "description": "OKR progress-delete. Inline JSON replaces local files and stdin.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "progress-id": {
                    "type": "string"
                }
            },
            "additionalProperties": false
        }
    },
    {
        "id": "okr.+progress-get",
        "domain": "okr",
        "source": "shortcut",
        "risk": "read",
        "identities": [
            "user",
            "bot"
        ],
        "scopes": [
            "okr:okr.progress:readonly"
        ],
        "description": "OKR progress-get. Inline JSON replaces local files and stdin.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "progress-id": {
                    "type": "string"
                },
                "user-id-type": {
                    "type": "string"
                },
                "style": {
                    "type": "string"
                }
            },
            "additionalProperties": false
        }
    },
    {
        "id": "okr.+progress-list",
        "domain": "okr",
        "source": "shortcut",
        "risk": "read",
        "identities": [
            "user",
            "bot"
        ],
        "scopes": [
            "okr:okr.progress:readonly"
        ],
        "description": "OKR progress-list. Inline JSON replaces local files and stdin.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "target-id": {
                    "type": "string"
                },
                "target-type": {
                    "type": "string"
                },
                "user-id-type": {
                    "type": "string"
                },
                "department-id-type": {
                    "type": "string"
                },
                "page-size": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100
                },
                "page-token": {
                    "type": "string"
                }
            },
            "additionalProperties": false
        }
    },
    {
        "id": "okr.+progress-update",
        "domain": "okr",
        "source": "shortcut",
        "risk": "write",
        "identities": [
            "user",
            "bot"
        ],
        "scopes": [
            "okr:okr.progress:writeonly"
        ],
        "description": "OKR progress-update. Inline JSON replaces local files and stdin.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "progress-id": {
                    "type": "string"
                },
                "content": {
                    "anyOf": [
                        {
                            "type": "string"
                        },
                        {
                            "type": "object"
                        }
                    ]
                },
                "progress-percent": {
                    "type": "string"
                },
                "progress-status": {
                    "type": "string"
                },
                "user-id-type": {
                    "type": "string"
                },
                "style": {
                    "type": "string"
                }
            },
            "additionalProperties": false
        }
    }
];

okrDefinitions.push(...[
    {
        "id": "okr.+indicator-update",
        "domain": "okr",
        "source": "shortcut",
        "risk": "write",
        "identities": [
            "user",
            "bot"
        ],
        "scopes": [
            "okr:okr.content:writeonly"
        ],
        "description": "OKR indicator-update. Resume pending results with workflow.resume.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "level": {
                    "type": "string"
                },
                "id": {
                    "type": "string"
                },
                "value": {
                    "type": "string"
                }
            },
            "additionalProperties": false
        }
    },
    {
        "id": "okr.+reorder",
        "domain": "okr",
        "source": "shortcut",
        "risk": "write",
        "identities": [
            "user",
            "bot"
        ],
        "scopes": [
            "okr:okr.content:writeonly"
        ],
        "description": "OKR reorder. Resume pending results with workflow.resume.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "level": {
                    "type": "string"
                },
                "cycle-id": {
                    "type": "string"
                },
                "objective-id": {
                    "type": "string"
                },
                "ops": {
                    "anyOf": [
                        {
                            "type": "string"
                        },
                        {
                            "type": "array",
                            "items": {
                                "type": "object"
                            }
                        }
                    ]
                }
            },
            "additionalProperties": false
        }
    },
    {
        "id": "okr.+weight",
        "domain": "okr",
        "source": "shortcut",
        "risk": "write",
        "identities": [
            "user",
            "bot"
        ],
        "scopes": [
            "okr:okr.content:writeonly"
        ],
        "description": "OKR weight. Resume pending results with workflow.resume.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "level": {
                    "type": "string"
                },
                "cycle-id": {
                    "type": "string"
                },
                "objective-id": {
                    "type": "string"
                },
                "weights": {
                    "anyOf": [
                        {
                            "type": "string"
                        },
                        {
                            "type": "array",
                            "items": {
                                "type": "object"
                            }
                        }
                    ]
                }
            },
            "additionalProperties": false
        }
    }
] satisfies CommandDefinition[]);

okrDefinitions.push(...[
    {
        "id": "okr.+comment-detail",
        "domain": "okr",
        "source": "shortcut",
        "risk": "read",
        "identities": [
            "user",
            "bot"
        ],
        "scopes": [
            "okr:okr.comment.readonly",
            "okr:okr.content:readonly",
            "okr:okr.progress:readonly"
        ],
        "description": "OKR comment-detail. Resume pending results with workflow.resume.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "cycle-id": {
                    "type": "string"
                },
                "style": {
                    "type": "string"
                }
            },
            "required": [
                "cycle-id"
            ],
            "additionalProperties": false
        }
    },
    {
        "id": "okr.+cycle-detail",
        "domain": "okr",
        "source": "shortcut",
        "risk": "read",
        "identities": [
            "user",
            "bot"
        ],
        "scopes": [
            "okr:okr.content:readonly"
        ],
        "description": "OKR cycle-detail. Resume pending results with workflow.resume.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "cycle-id": {
                    "type": "string"
                },
                "style": {
                    "type": "string"
                }
            },
            "required": [
                "cycle-id"
            ],
            "additionalProperties": false
        }
    }
] satisfies CommandDefinition[]);

okrDefinitions.push({ id: 'okr.+batch-create', domain: 'okr', source: 'shortcut', risk: 'write', identities: ['user', 'bot'], scopes: ['okr:okr.content:writeonly'],
    description: 'Create objectives and key results with rollback after definite failures. Resume pending results with workflow.resume.',
    inputSchema: { type: 'object', required: ['cycle-id', 'input'], properties: { 'cycle-id': { type: 'string' }, input: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'object' } }] }, 'category-id': { type: 'string' }, 'user-id-type': { type: 'string' } }, additionalProperties: false },
});

okrDefinitions.push({ id: 'okr.+upload-image', domain: 'okr', source: 'shortcut', risk: 'write', identities: ['user', 'bot'], scopes: ['okr:okr.progress.file:upload'],
    description: 'Upload a private artifact image. Requires artifact read permission. file is the artifact ID and name is the original image filename.',
    inputSchema: { type: 'object', required: ['file', 'target-id', 'target-type'], properties: { file: { type: 'string' }, name: { type: 'string' }, 'target-id': { type: 'string' }, 'target-type': { type: 'string', enum: ['objective', 'key_result'] } }, additionalProperties: false },
});
