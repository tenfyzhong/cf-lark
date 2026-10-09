# Streaming raw mail envelopes

`extractRawMailStream(response)` extracts the base64url string at `data.raw` or `data.draft.raw` from a streamed Lark JSON response. It exposes decoded EML bytes through a backpressured readable stream and a separate metadata promise resolving to the data object with the raw field omitted.

The parser validates the complete JSON envelope, rejects duplicate keys and multiple raw fields, checks the upstream success code, and rejects trailing non-whitespace. JSON string escapes are decoded before base64url validation. Padded and unpadded encodings are accepted; malformed padding, invalid characters and incomplete encodings are rejected. Decoded EML is limited to 25 MiB, retained JSON metadata to 1 MiB, and nesting depth to 64. Neither the encoded raw string nor the decoded message is collected in memory.

Consumers must stage extracted attachments privately and await both successful body consumption and metadata validation before sending any reconstructed message upstream. A malformed suffix can be detected after some bytes have already streamed. Cancellation rejects metadata and cancels the upstream reader. The parser uses bounded UTF-8 windows and output chunks so processing respects backpressure.
