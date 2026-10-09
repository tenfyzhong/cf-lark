import type { CommandDefinition } from '../../domain/models';
export const mailDefinitions: CommandDefinition[] = [
    {
        id: 'mail.+decline-receipt',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user'],
        scopes: [
            'mail:user_mailbox.message:modify',
            'mail:user_mailbox.message:readonly',
            'mail:user_mailbox:readonly',
            'mail:user_mailbox.message.body:read',
        ],
        description:
            'Mail decline-receipt. Resume pending results with workflow.resume. Bot identity requires an explicit mailbox.',
        inputSchema: {
            type: 'object',
            properties: {
                'message-id': {
                    type: 'string',
                },
                mailbox: {
                    type: 'string',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+message-modify',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user'],
        scopes: ['mail:user_mailbox.message:modify'],
        description:
            'Mail message-modify. Resume pending results with workflow.resume. Bot identity requires an explicit mailbox.',
        inputSchema: {
            type: 'object',
            properties: {
                mailbox: {
                    type: 'string',
                },
                'message-ids': {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                'add-label-ids': {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                'remove-label-ids': {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                'add-folder': {
                    type: 'string',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+message-trash',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user'],
        scopes: ['mail:user_mailbox.message:modify'],
        description:
            'Mail message-trash. Resume pending results with workflow.resume. Bot identity requires an explicit mailbox.',
        inputSchema: {
            type: 'object',
            properties: {
                mailbox: {
                    type: 'string',
                },
                'message-ids': {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+thread-modify',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user', 'bot'],
        scopes: ['mail:user_mailbox.message:modify'],
        description:
            'Mail thread-modify. Resume pending results with workflow.resume. Bot identity requires an explicit mailbox.',
        inputSchema: {
            type: 'object',
            properties: {
                mailbox: {
                    type: 'string',
                },
                'thread-ids': {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                'add-label-ids': {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                'remove-label-ids': {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                'add-folder': {
                    type: 'string',
                },
                'folder-id': {
                    type: 'string',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+thread-trash',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user', 'bot'],
        scopes: ['mail:user_mailbox.message:modify'],
        description:
            'Mail thread-trash. Resume pending results with workflow.resume. Bot identity requires an explicit mailbox.',
        inputSchema: {
            type: 'object',
            properties: {
                mailbox: {
                    type: 'string',
                },
                'thread-ids': {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+message',
        domain: 'mail',
        source: 'shortcut',
        risk: 'read',
        identities: ['user', 'bot'],
        scopes: [
            'mail:user_mailbox.message:readonly',
            'mail:user_mailbox.message.address:read',
            'mail:user_mailbox.message.subject:read',
            'mail:user_mailbox.message.body:read',
        ],
        description:
            'Read and normalize mail. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                mailbox: {
                    type: 'string',
                },
                'message-id': {
                    type: 'string',
                },
                html: {
                    type: 'boolean',
                },
                'print-output-schema': {
                    type: 'boolean',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+messages',
        domain: 'mail',
        source: 'shortcut',
        risk: 'read',
        identities: ['user', 'bot'],
        scopes: [
            'mail:user_mailbox.message:readonly',
            'mail:user_mailbox.message.address:read',
            'mail:user_mailbox.message.subject:read',
            'mail:user_mailbox.message.body:read',
        ],
        description:
            'Read and normalize mail. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                mailbox: {
                    type: 'string',
                },
                'message-ids': {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                html: {
                    type: 'boolean',
                },
                'print-output-schema': {
                    type: 'boolean',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+thread',
        domain: 'mail',
        source: 'shortcut',
        risk: 'read',
        identities: ['user', 'bot'],
        scopes: [
            'mail:user_mailbox.message:readonly',
            'mail:user_mailbox.message.address:read',
            'mail:user_mailbox.message.subject:read',
            'mail:user_mailbox.message.body:read',
        ],
        description:
            'Read and normalize mail. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                mailbox: {
                    type: 'string',
                },
                'thread-id': {
                    type: 'string',
                },
                html: {
                    type: 'boolean',
                },
                'include-spam-trash': {
                    type: 'boolean',
                },
                'print-output-schema': {
                    type: 'boolean',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+draft-send',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user'],
        scopes: ['mail:user_mailbox.message:send'],
        description:
            'Manage mail signatures and delivery. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                mailbox: {
                    type: 'string',
                },
                'draft-id': {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                'stop-on-error': {
                    type: 'boolean',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+share-to-chat',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user'],
        scopes: [
            'mail:user_mailbox.message:readonly',
            'im:message',
            'im:message.send_as_user',
        ],
        description:
            'Manage mail signatures and delivery. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                'message-id': {
                    type: 'string',
                },
                'thread-id': {
                    type: 'string',
                },
                'receive-id': {
                    type: 'string',
                },
                'receive-id-type': {
                    type: 'string',
                },
                mailbox: {
                    type: 'string',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+signature',
        domain: 'mail',
        source: 'shortcut',
        risk: 'read',
        identities: ['user'],
        scopes: ['mail:user_mailbox:readonly'],
        description:
            'Manage mail signatures and delivery. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                from: {
                    type: 'string',
                },
                detail: {
                    type: 'string',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+rule-create',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user', 'bot'],
        scopes: ['mail:user_mailbox.rule:write'],
        description:
            'Manage semantic mailbox rules. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                'user-mailbox-id': {
                    type: 'string',
                },
                enable: {
                    type: 'boolean',
                },
                disable: {
                    type: 'boolean',
                },
                match: {
                    type: 'string',
                },
                'stop-after-match': {
                    type: 'boolean',
                },
                'continue-after-match': {
                    type: 'boolean',
                },
                condition: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'object',
                        },
                        {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                    },
                                    {
                                        type: 'object',
                                    },
                                ],
                            },
                        },
                    ],
                },
                conditions: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'object',
                        },
                        {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                    },
                                    {
                                        type: 'object',
                                    },
                                ],
                            },
                        },
                    ],
                },
                action: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'object',
                        },
                        {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                    },
                                    {
                                        type: 'object',
                                    },
                                ],
                            },
                        },
                    ],
                },
                actions: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'object',
                        },
                        {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                    },
                                    {
                                        type: 'object',
                                    },
                                ],
                            },
                        },
                    ],
                },
                name: {
                    type: 'string',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+rule-delete',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user', 'bot'],
        scopes: ['mail:user_mailbox.rule:write'],
        description:
            'Manage semantic mailbox rules. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                'user-mailbox-id': {
                    type: 'string',
                },
                'rule-id': {
                    type: 'string',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+rule-disable',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user', 'bot'],
        scopes: ['mail:user_mailbox.rule:write'],
        description:
            'Manage semantic mailbox rules. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                'user-mailbox-id': {
                    type: 'string',
                },
                'rule-id': {
                    type: 'string',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+rule-enable',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user', 'bot'],
        scopes: ['mail:user_mailbox.rule:write'],
        description:
            'Manage semantic mailbox rules. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                'user-mailbox-id': {
                    type: 'string',
                },
                'rule-id': {
                    type: 'string',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+rule-get',
        domain: 'mail',
        source: 'shortcut',
        risk: 'read',
        identities: ['user', 'bot'],
        scopes: ['mail:user_mailbox.rule:read'],
        description:
            'Manage semantic mailbox rules. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                'user-mailbox-id': {
                    type: 'string',
                },
                'rule-id': {
                    type: 'string',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+rule-list',
        domain: 'mail',
        source: 'shortcut',
        risk: 'read',
        identities: ['user', 'bot'],
        scopes: ['mail:user_mailbox.rule:read'],
        description:
            'Manage semantic mailbox rules. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                'user-mailbox-id': {
                    type: 'string',
                },
                'name-contains': {
                    type: 'string',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+rule-reorder',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user', 'bot'],
        scopes: ['mail:user_mailbox.rule:write'],
        description:
            'Manage semantic mailbox rules. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                'user-mailbox-id': {
                    type: 'string',
                },
                'rule-ids': {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                'move-rule-id': {
                    type: 'string',
                },
                'before-rule-id': {
                    type: 'string',
                },
                'after-rule-id': {
                    type: 'string',
                },
                'to-top': {
                    type: 'boolean',
                },
                'to-bottom': {
                    type: 'boolean',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+rule-update',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user', 'bot'],
        scopes: ['mail:user_mailbox.rule:write'],
        description:
            'Manage semantic mailbox rules. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                'user-mailbox-id': {
                    type: 'string',
                },
                enable: {
                    type: 'boolean',
                },
                disable: {
                    type: 'boolean',
                },
                match: {
                    type: 'string',
                },
                'stop-after-match': {
                    type: 'boolean',
                },
                'continue-after-match': {
                    type: 'boolean',
                },
                condition: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'object',
                        },
                        {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                    },
                                    {
                                        type: 'object',
                                    },
                                ],
                            },
                        },
                    ],
                },
                conditions: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'object',
                        },
                        {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                    },
                                    {
                                        type: 'object',
                                    },
                                ],
                            },
                        },
                    ],
                },
                action: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'object',
                        },
                        {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                    },
                                    {
                                        type: 'object',
                                    },
                                ],
                            },
                        },
                    ],
                },
                actions: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'object',
                        },
                        {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                    },
                                    {
                                        type: 'object',
                                    },
                                ],
                            },
                        },
                    ],
                },
                name: {
                    type: 'string',
                },
                'rule-id': {
                    type: 'string',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+triage',
        domain: 'mail',
        source: 'shortcut',
        risk: 'read',
        identities: ['user', 'bot'],
        scopes: [
            'mail:user_mailbox.message:readonly',
            'mail:user_mailbox.message.address:read',
            'mail:user_mailbox.message.subject:read',
            'mail:user_mailbox.message.body:read',
        ],
        description:
            'List or search mailbox message summaries with pagination and metadata. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                format: {
                    type: 'string',
                },
                max: {
                    type: 'integer',
                },
                'page-token': {
                    type: 'string',
                },
                filter: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'object',
                        },
                    ],
                },
                folder: {
                    type: 'string',
                },
                'folder-id': {
                    type: 'string',
                },
                'is-unread': {
                    type: 'boolean',
                },
                mailbox: {
                    type: 'string',
                },
                query: {
                    type: 'string',
                },
                labels: {
                    type: 'boolean',
                },
                'print-filter-schema': {
                    type: 'boolean',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+watch',
        domain: 'mail',
        source: 'shortcut',
        risk: 'read',
        identities: ['user'],
        scopes: [
            'mail:event',
            'mail:user_mailbox.event.mail_address:read',
            'mail:user_mailbox:readonly',
            'mail:user_mailbox.message:readonly',
            'mail:user_mailbox.message.address:read',
            'mail:user_mailbox.message.subject:read',
            'mail:user_mailbox.message.body:read',
        ],
        description:
            'Watch mail via verified callbacks. Poll with the returned cursor; stop=true unsubscribes. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                format: {
                    type: 'string',
                },
                'msg-format': {
                    type: 'string',
                },
                'output-dir': {
                    type: 'string',
                },
                mailbox: {
                    type: 'string',
                },
                labels: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                folders: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                'label-ids': {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                'folder-ids': {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                'print-output-schema': {
                    type: 'boolean',
                },
                cursor: {
                    type: 'integer',
                    minimum: 0,
                },
                limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 100,
                },
                stop: {
                    type: 'boolean',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+lint-html',
        domain: 'mail',
        source: 'shortcut',
        risk: 'read',
        identities: ['user', 'bot'],
        scopes: [],
        description:
            'Lint HTML with the pinned mail sanitizer; body-file is a private artifact ID.',
        inputSchema: {
            type: 'object',
            properties: {
                body: {
                    type: 'string',
                },
                'body-file': {
                    type: 'string',
                },
                'show-lint-details': {
                    type: 'boolean',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+draft-create',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user'],
        scopes: [
            'mail:user_mailbox.message:modify',
            'mail:user_mailbox:readonly',
        ],
        description:
            'Compose and edit mail drafts with pinned MIME transformations. File inputs are private artifacts. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                to: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                subject: {
                    type: 'string',
                },
                body: {
                    type: 'string',
                },
                'body-file': {
                    type: 'string',
                },
                from: {
                    type: 'string',
                },
                mailbox: {
                    type: 'string',
                },
                cc: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                bcc: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                'plain-text': {
                    type: 'boolean',
                },
                attach: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'object',
                        },
                        {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                    },
                                    {
                                        type: 'object',
                                    },
                                ],
                            },
                        },
                    ],
                },
                inline: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'object',
                        },
                        {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                    },
                                    {
                                        type: 'object',
                                    },
                                ],
                            },
                        },
                    ],
                },
                'request-receipt': {
                    type: 'boolean',
                },
                'template-id': {
                    type: 'string',
                },
                'signature-id': {
                    type: 'string',
                },
                'no-signature': {
                    type: 'boolean',
                },
                priority: {
                    type: 'string',
                },
                'event-summary': {
                    type: 'string',
                },
                'event-start': {
                    type: 'string',
                },
                'event-end': {
                    type: 'string',
                },
                'event-location': {
                    type: 'string',
                },
                'show-lint-details': {
                    type: 'boolean',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+draft-edit',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user'],
        scopes: [
            'mail:user_mailbox.message:modify',
            'mail:user_mailbox.message:readonly',
            'mail:user_mailbox:readonly',
        ],
        description:
            'Compose and edit mail drafts with pinned MIME transformations. File inputs are private artifacts. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                from: {
                    type: 'string',
                },
                mailbox: {
                    type: 'string',
                },
                'draft-id': {
                    type: 'string',
                },
                'set-subject': {
                    type: 'string',
                },
                'set-to': {
                    type: 'string',
                },
                'set-cc': {
                    type: 'string',
                },
                'set-bcc': {
                    type: 'string',
                },
                body: {
                    type: 'string',
                },
                'body-file': {
                    type: 'string',
                },
                'patch-file': {
                    type: 'string',
                },
                'print-patch-template': {
                    type: 'boolean',
                },
                'set-priority': {
                    type: 'string',
                },
                'set-event-summary': {
                    type: 'string',
                },
                'set-event-start': {
                    type: 'string',
                },
                'set-event-end': {
                    type: 'string',
                },
                'set-event-location': {
                    type: 'string',
                },
                'remove-event': {
                    type: 'boolean',
                },
                inspect: {
                    type: 'boolean',
                },
                'request-receipt': {
                    type: 'boolean',
                },
                'show-lint-details': {
                    type: 'boolean',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+forward',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user'],
        scopes: [
            'mail:user_mailbox.message:modify',
            'mail:user_mailbox.message:readonly',
            'mail:user_mailbox:readonly',
            'mail:user_mailbox.message.address:read',
            'mail:user_mailbox.message.subject:read',
            'mail:user_mailbox.message.body:read',
        ],
        description:
            'Compose and edit mail drafts with pinned MIME transformations. File inputs are private artifacts. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                'message-id': {
                    type: 'string',
                },
                to: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                body: {
                    type: 'string',
                },
                'body-file': {
                    type: 'string',
                },
                from: {
                    type: 'string',
                },
                mailbox: {
                    type: 'string',
                },
                cc: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                bcc: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                'plain-text': {
                    type: 'boolean',
                },
                attach: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'object',
                        },
                        {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                    },
                                    {
                                        type: 'object',
                                    },
                                ],
                            },
                        },
                    ],
                },
                inline: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'object',
                        },
                        {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                    },
                                    {
                                        type: 'object',
                                    },
                                ],
                            },
                        },
                    ],
                },
                'confirm-send': {
                    type: 'boolean',
                },
                'send-time': {
                    type: 'string',
                },
                'request-receipt': {
                    type: 'boolean',
                },
                subject: {
                    type: 'string',
                },
                'template-id': {
                    type: 'string',
                },
                'signature-id': {
                    type: 'string',
                },
                'no-signature': {
                    type: 'boolean',
                },
                priority: {
                    type: 'string',
                },
                'event-summary': {
                    type: 'string',
                },
                'event-start': {
                    type: 'string',
                },
                'event-end': {
                    type: 'string',
                },
                'event-location': {
                    type: 'string',
                },
                'show-lint-details': {
                    type: 'boolean',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+reply',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user'],
        scopes: [
            'mail:user_mailbox.message:modify',
            'mail:user_mailbox.message:readonly',
            'mail:user_mailbox:readonly',
            'mail:user_mailbox.message.address:read',
            'mail:user_mailbox.message.subject:read',
            'mail:user_mailbox.message.body:read',
        ],
        description:
            'Compose and edit mail drafts with pinned MIME transformations. File inputs are private artifacts. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                'message-id': {
                    type: 'string',
                },
                body: {
                    type: 'string',
                },
                'body-file': {
                    type: 'string',
                },
                from: {
                    type: 'string',
                },
                mailbox: {
                    type: 'string',
                },
                to: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                cc: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                bcc: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                'plain-text': {
                    type: 'boolean',
                },
                attach: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'object',
                        },
                        {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                    },
                                    {
                                        type: 'object',
                                    },
                                ],
                            },
                        },
                    ],
                },
                inline: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'object',
                        },
                        {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                    },
                                    {
                                        type: 'object',
                                    },
                                ],
                            },
                        },
                    ],
                },
                'confirm-send': {
                    type: 'boolean',
                },
                'send-time': {
                    type: 'string',
                },
                'request-receipt': {
                    type: 'boolean',
                },
                subject: {
                    type: 'string',
                },
                'template-id': {
                    type: 'string',
                },
                'signature-id': {
                    type: 'string',
                },
                'no-signature': {
                    type: 'boolean',
                },
                priority: {
                    type: 'string',
                },
                'event-summary': {
                    type: 'string',
                },
                'event-start': {
                    type: 'string',
                },
                'event-end': {
                    type: 'string',
                },
                'event-location': {
                    type: 'string',
                },
                'show-lint-details': {
                    type: 'boolean',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+reply-all',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user'],
        scopes: [
            'mail:user_mailbox.message:modify',
            'mail:user_mailbox.message:readonly',
            'mail:user_mailbox:readonly',
            'mail:user_mailbox.message.address:read',
            'mail:user_mailbox.message.subject:read',
            'mail:user_mailbox.message.body:read',
        ],
        description:
            'Compose and edit mail drafts with pinned MIME transformations. File inputs are private artifacts. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                'message-id': {
                    type: 'string',
                },
                body: {
                    type: 'string',
                },
                'body-file': {
                    type: 'string',
                },
                from: {
                    type: 'string',
                },
                mailbox: {
                    type: 'string',
                },
                to: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                cc: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                bcc: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                remove: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                'plain-text': {
                    type: 'boolean',
                },
                attach: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'object',
                        },
                        {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                    },
                                    {
                                        type: 'object',
                                    },
                                ],
                            },
                        },
                    ],
                },
                inline: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'object',
                        },
                        {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                    },
                                    {
                                        type: 'object',
                                    },
                                ],
                            },
                        },
                    ],
                },
                'confirm-send': {
                    type: 'boolean',
                },
                'send-time': {
                    type: 'string',
                },
                'request-receipt': {
                    type: 'boolean',
                },
                subject: {
                    type: 'string',
                },
                'template-id': {
                    type: 'string',
                },
                'signature-id': {
                    type: 'string',
                },
                'no-signature': {
                    type: 'boolean',
                },
                priority: {
                    type: 'string',
                },
                'event-summary': {
                    type: 'string',
                },
                'event-start': {
                    type: 'string',
                },
                'event-end': {
                    type: 'string',
                },
                'event-location': {
                    type: 'string',
                },
                'show-lint-details': {
                    type: 'boolean',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+send',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user'],
        scopes: [
            'mail:user_mailbox.message:send',
            'mail:user_mailbox.message:modify',
            'mail:user_mailbox:readonly',
        ],
        description:
            'Compose and edit mail drafts with pinned MIME transformations. File inputs are private artifacts. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                to: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                subject: {
                    type: 'string',
                },
                body: {
                    type: 'string',
                },
                'body-file': {
                    type: 'string',
                },
                from: {
                    type: 'string',
                },
                mailbox: {
                    type: 'string',
                },
                cc: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                bcc: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'string',
                            },
                        },
                    ],
                },
                'plain-text': {
                    type: 'boolean',
                },
                attach: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'object',
                        },
                        {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                    },
                                    {
                                        type: 'object',
                                    },
                                ],
                            },
                        },
                    ],
                },
                inline: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'object',
                        },
                        {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                    },
                                    {
                                        type: 'object',
                                    },
                                ],
                            },
                        },
                    ],
                },
                'confirm-send': {
                    type: 'boolean',
                },
                'send-time': {
                    type: 'string',
                },
                'request-receipt': {
                    type: 'boolean',
                },
                'template-id': {
                    type: 'string',
                },
                'signature-id': {
                    type: 'string',
                },
                'no-signature': {
                    type: 'boolean',
                },
                priority: {
                    type: 'string',
                },
                'event-summary': {
                    type: 'string',
                },
                'event-start': {
                    type: 'string',
                },
                'event-end': {
                    type: 'string',
                },
                'event-location': {
                    type: 'string',
                },
                'show-lint-details': {
                    type: 'boolean',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+send-receipt',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user'],
        scopes: [
            'mail:user_mailbox.message:send',
            'mail:user_mailbox.message:modify',
            'mail:user_mailbox.message:readonly',
            'mail:user_mailbox:readonly',
            'mail:user_mailbox.message.address:read',
            'mail:user_mailbox.message.subject:read',
            'mail:user_mailbox.message.body:read',
        ],
        description:
            'Compose and edit mail drafts with pinned MIME transformations. File inputs are private artifacts. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                'message-id': {
                    type: 'string',
                },
                mailbox: {
                    type: 'string',
                },
                from: {
                    type: 'string',
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+template-create',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user', 'bot'],
        scopes: [
            'mail:user_mailbox.message:modify',
            'mail:user_mailbox:readonly',
        ],
        description:
            'Create or update a mail template with private artifact attachments. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                mailbox: {
                    type: 'string',
                },
                name: {
                    type: 'string',
                },
                subject: {
                    type: 'string',
                },
                'template-content': {
                    type: 'string',
                },
                'template-content-file': {
                    type: 'string',
                },
                'plain-text': {
                    type: 'boolean',
                },
                to: {
                    type: 'string',
                },
                cc: {
                    type: 'string',
                },
                bcc: {
                    type: 'string',
                },
                attach: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                    },
                                    {
                                        type: 'object',
                                        additionalProperties: true,
                                    },
                                ],
                            },
                        },
                    ],
                },
                inline: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'object',
                                additionalProperties: true,
                            },
                        },
                    ],
                },
            },
            additionalProperties: false,
        },
    },
    {
        id: 'mail.+template-update',
        domain: 'mail',
        source: 'shortcut',
        risk: 'write',
        identities: ['user', 'bot'],
        scopes: [
            'mail:user_mailbox.message:modify',
            'mail:user_mailbox:readonly',
        ],
        description:
            'Create or update a mail template with private artifact attachments. Resume pending results with workflow.resume.',
        inputSchema: {
            type: 'object',
            properties: {
                mailbox: {
                    type: 'string',
                },
                'template-id': {
                    type: 'string',
                },
                inspect: {
                    type: 'boolean',
                },
                'print-patch-template': {
                    type: 'boolean',
                },
                'patch-file': {
                    type: 'string',
                },
                'set-name': {
                    type: 'string',
                },
                'set-subject': {
                    type: 'string',
                },
                'set-template-content': {
                    type: 'string',
                },
                'set-template-content-file': {
                    type: 'string',
                },
                'set-plain-text': {
                    type: 'boolean',
                },
                'set-to': {
                    type: 'string',
                },
                'set-cc': {
                    type: 'string',
                },
                'set-bcc': {
                    type: 'string',
                },
                attach: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                    },
                                    {
                                        type: 'object',
                                        additionalProperties: true,
                                    },
                                ],
                            },
                        },
                    ],
                },
                inline: {
                    anyOf: [
                        {
                            type: 'string',
                        },
                        {
                            type: 'array',
                            items: {
                                type: 'object',
                                additionalProperties: true,
                            },
                        },
                    ],
                },
            },
            additionalProperties: false,
        },
    },
];
