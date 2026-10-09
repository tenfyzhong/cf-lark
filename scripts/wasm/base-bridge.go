// Pure adapter and number normalization derived from lark-cli 1.0.97.
// Copyright (c) 2026 Lark Technologies Pte. Ltd.
// SPDX-License-Identifier: MIT

package main

import (
    "bytes"
    "context"
    "encoding/json"
    "fmt"
    "syscall/js"
    "time"

    "github.com/itchyny/gojq"
    "github.com/larksuite/cli/shortcuts/doc/internal/recordexport"
)

// JavaScript callbacks cannot run host timers until returning. Check the deadline
// synchronously at each gojq opcode instead of relying on a timer goroutine.
type synchronousDeadline struct { context.Context; deadline time.Time; done chan struct{}; expired bool; checks uint64 }
func(c *synchronousDeadline) Done() <-chan struct{} {c.checks++; if !c.expired && (c.checks%1024==0 && time.Now().After(c.deadline) || c.checks>10000000) {c.expired=true;close(c.done)};return c.done}
func(c *synchronousDeadline) Err() error {if c.expired{return context.DeadlineExceeded};return nil}
func(c *synchronousDeadline) Deadline()(time.Time,bool){return c.deadline,true}

func baseRecordOperation(raw string) (any, error) {
    var input struct {
        Operation string `json:"operation"`
        Pages []map[string]any `json:"pages"`
        Options recordexport.ManifestOptions `json:"options"`
        Data map[string]any `json:"data"`
        Get bool `json:"get"`
        Expression string `json:"expression"`
        Input any `json:"input"`
    }
    decoder := json.NewDecoder(bytes.NewBufferString(raw))
    decoder.UseNumber()
    if err := decoder.Decode(&input); err != nil { return nil, err }
    switch input.Operation {
    case "markdown":
        if input.Get { return renderRecordGetMarkdown(input.Data) }
        return renderRecordMarkdown(input.Data)
    case "jq", "jq-validate":
        query, err := gojq.Parse(input.Expression)
        if err != nil { return nil, err }
        code, err := gojq.Compile(query)
        if err != nil { return nil, err }
        if input.Operation == "jq-validate" { return true, nil }
        ctx := &synchronousDeadline{Context:context.Background(),deadline:time.Now().Add(2*time.Second),done:make(chan struct{})}
        iterator := code.RunWithContext(ctx, convertNumbers(input.Input))
        values := []any{}
        for {
            value, more := iterator.Next()
            if !more { break }
            if err, ok := value.(error); ok { return nil, err }
            if len(values) >= 10000 { return nil, fmt.Errorf("jq output exceeds 10000 values") }
            values = append(values, value)
        }
        return values, nil
    case "export":
        if len(input.Pages) == 0 { return nil, fmt.Errorf("record export received no pages") }
        var dataset recordexport.Dataset
        options := input.Options
        seenIgnored, seenMissing := map[string]bool{}, map[string]bool{}
        for i, data := range input.Pages {
            page, err := recordexport.ParseMatrix(data)
            if err != nil { return nil, err }
            if i == 0 {
                dataset = page.Dataset
                options.Rev = page.Rev
                options.QueryContext = page.QueryContext
            } else if err := dataset.AppendPage(page); err != nil { return nil, err }
            options.HasMore = page.HasMore
            for _, field := range page.IgnoredFields {
                key, _ := json.Marshal(field)
                if !seenIgnored[string(key)] { options.IgnoredFields = append(options.IgnoredFields, field); seenIgnored[string(key)] = true }
            }
            for _, id := range page.RecordNotFound {
                if !seenMissing[id] { options.RecordNotFound = append(options.RecordNotFound, id); seenMissing[id] = true }
            }
        }
        options.PageCount = len(input.Pages)
        var output bytes.Buffer
        if err := recordexport.WriteNDJSON(&output, dataset); err != nil { return nil, err }
        options.RecordFileSizeBytes = int64(output.Len())
        rows := make([]map[string]any, 0, len(dataset.Records))
        for _, record := range dataset.Records {
            row := map[string]any{}
            for index, column := range dataset.Columns { row[column.Name] = record.Values[index] }
            rows = append(rows, row)
        }
        return map[string]any{"ndjson": output.String(), "manifest": recordexport.BuildManifest(dataset, options), "records": rows}, nil
    }
    return nil, fmt.Errorf("unsupported Base formatter operation")
}

func init() {
    js.Global().Set("cfLarkBaseRecords", js.FuncOf(func(_ js.Value, args []js.Value) any {
        result, err := baseRecordOperation(args[0].String())
        envelope := map[string]any{"result": result}
        if err != nil { envelope = map[string]any{"error": err.Error()} }
        encoded, err := json.Marshal(envelope)
        if err != nil { return `{"error":"Base formatter response serialization failed"}` }
        return string(encoded)
    }))
}

func convertNumbers(v interface{}) interface{} {
	switch val := v.(type) {
	case json.Number:
		if i, err := val.Int64(); err == nil {
			return int(i)
		}
		if f, err := val.Float64(); err == nil {
			return f
		}
		// Fallback: return as string (shouldn't happen for valid JSON numbers).
		return val.String()
	case map[string]interface{}:
		for k, elem := range val {
			val[k] = convertNumbers(elem)
		}
		return val
	case []interface{}:
		for i, elem := range val {
			val[i] = convertNumbers(elem)
		}
		return val
	default:
		return v
	}
}
